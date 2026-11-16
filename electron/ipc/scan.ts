import fsp from "node:fs/promises";
import path from "node:path";
import { dialog } from "electron";
import { loadConfig, updateConfig } from "../core/appConfig.js";
import { handle } from "../core/ipcHandler.js";
import { AutoTagRuleDroppedError } from "../core/autoTagDeriver.js";
import {
  applyScanExclusions,
  coveredListedFiles,
  scanExclusionFilter,
} from "../core/scanExclusionFilter.js";
import { scopedLog } from "../core/logger.js";
import {
  MAX_EXCLUDED_FOLDERS,
  MAX_PATTERN_PREVIEW_FILES,
  patternError,
  samePattern,
} from "../../shared/scanExclusions.js";
import { isNormalizedFolderPath } from "../../shared/folderPath.js";
import type {
  ExcludedFolders,
  PatternPreview,
  PickedFolder,
  ScanExclusionsState,
} from "../../shared/ipc/channels.js";
import type { IpcContext } from "./context.js";
import { coreById } from "./helpers.js";

const log = scopedLog("scan");

export function registerScanHandlers(ctx: IpcContext): void {
  handle("scan_start", ({ includeExcluded, rebuild }) =>
    ctx.scans.start({ includeExcluded, rebuild }),
  );

  handle("scan_unreadable_workspaces", () => ctx.scans.unreadableWorkspaces());

  handle("scan_cancel", ({ wsId }) => {
    if (wsId) void ctx.scans.abort(wsId);
    else void ctx.scans.abortAll();
  });

  const exclusionsState = (): ScanExclusionsState => ({
    patterns: loadConfig().scanExclusions.patterns,
  });

  handle("scan_exclusions_get", exclusionsState);

  /**
   * Hide what the saved exclusions cover now, in the workspaces `only` names
   * (every one when omitted), without reading the disk. Called once a change
   * is saved, so a failure is not the save's: it is logged, and the next scan
   * applies the exclusions (or fails, telling why).
   */
  const hideCovered = async (only?: string): Promise<void> => {
    const saved = loadConfig().scanExclusions;
    let hidden = 0;
    try {
      await ctx.passes.forEachWorkspace(
        () =>
          ctx.ws
            .allCores()
            .filter(({ id }) => only === undefined || id === only),
        async ({ id, core }, signal) => {
          hidden += await applyScanExclusions(
            core.db,
            core.rootId,
            scanExclusionFilter(saved, id, ctx.deriveAutoTags),
            signal,
          );
        },
      );
    } catch (err) {
      log.warn("could not hide what the scan exclusions cover", err);
    } finally {
      if (hidden > 0) {
        log.info(`scan exclusions: hid ${hidden} file(s)`);
        await ctx.queryClient.invalidateCaches().catch(() => {});
      }
    }
  };

  // Saved, then what the patterns now cover is hidden in every workspace
  // right away. A pattern taken out only lets its files come back at the next
  // scan, which reads the disk to find them.
  handle("scan_exclusions_set_patterns", async ({ patterns }) => {
    const wrong = patterns.find((p) => patternError(p) !== null);
    if (wrong !== undefined)
      throw new Error("a scan exclusion pattern does not compile");
    const unique = patterns.filter(
      (p, i) => patterns.findIndex((q) => samePattern(p, q)) === i,
    );
    updateConfig((c) => ({
      ...c,
      scanExclusions: { ...c.scanExclusions, patterns: unique },
    }));
    // A write that failed was logged, not thrown: tell the user it did not
    // save rather than show what is stored as their edit.
    if (
      JSON.stringify(loadConfig().scanExclusions.patterns) !==
      JSON.stringify(unique)
    )
      throw new Error("the scan exclusions could not be saved");
    await hideCovered();
    return exclusionsState();
  });

  /**
   * The workspace's excluded folders, where each is on disk (to show: the
   * relative path alone reads like any folder of that name) and whether it is
   * there now.
   */
  const excludedFolders = async (
    workspaceId: string,
  ): Promise<ExcludedFolders> => {
    const { root } = coreById(ctx.ws, workspaceId);
    const paths = loadConfig().scanExclusions.folders[workspaceId] ?? [];
    return {
      folders: await Promise.all(
        paths.map(async (p) => ({
          path: p,
          absPath: path.join(root, ...p.split("/")),
          found: await isFolder(root, p),
        })),
      ),
    };
  };

  /** Write the workspace's excluded folders, failing when it did not save. */
  const saveFolders = (
    workspaceId: string,
    change: (folders: string[]) => string[],
  ): void => {
    let wanted: string[] = [];
    updateConfig((c) => {
      const { [workspaceId]: current = [], ...others } =
        c.scanExclusions.folders;
      wanted = change(current);
      return {
        ...c,
        scanExclusions: {
          ...c.scanExclusions,
          folders:
            wanted.length > 0 ? { ...others, [workspaceId]: wanted } : others,
        },
      };
    });
    const saved = loadConfig().scanExclusions.folders[workspaceId] ?? [];
    if (JSON.stringify(saved) !== JSON.stringify(wanted))
      throw new Error("the excluded folders could not be saved");
  };

  handle("scan_exclusions_folders", ({ workspaceId }) =>
    excludedFolders(workspaceId),
  );

  // Saved, then the files under the folder are hidden right away.
  handle(
    "scan_exclusions_add_folder",
    async ({ workspaceId, path: folder }) => {
      coreById(ctx.ws, workspaceId);
      saveFolders(workspaceId, (current) => {
        if (current.includes(folder)) return current;
        if (current.length >= MAX_EXCLUDED_FOLDERS)
          throw new Error("too many excluded folders");
        return [...current, folder];
      });
      await hideCovered(workspaceId);
      return excludedFolders(workspaceId);
    },
  );

  // The edit dialog's changes, in one save. What the added folders hold is
  // hidden right away; the files of the removed ones come back at the next
  // scan, which reads the disk to find them.
  handle(
    "scan_exclusions_update_folders",
    async ({ workspaceId, add, remove }) => {
      coreById(ctx.ws, workspaceId);
      const removed = new Set(remove);
      saveFolders(workspaceId, (current) => {
        const kept = current.filter((f) => !removed.has(f));
        const next = [...new Set([...kept, ...add])];
        if (next.length > MAX_EXCLUDED_FOLDERS)
          throw new Error("too many excluded folders");
        return next;
      });
      if (add.length > 0) await hideCovered(workspaceId);
      return excludedFolders(workspaceId);
    },
  );

  // What a pattern would hide in every workspace, before it is added: it
  // runs in the auto-tag worker as the scan runs it, over each listed file
  // and the folders above it. Only reads.
  // A newer preview supersedes the one running: it stops at its next chunk,
  // so the worker is not kept busy (ahead of scans) with what nobody reads.
  let latestPreview = 0;
  handle("scan_exclusions_preview", async ({ pattern }) => {
    const error = patternError(pattern);
    if (error !== null) throw new Error(`invalid pattern: ${error}`);
    const seq = ++latestPreview;
    const superseded = new Error("superseded");
    const filter = scanExclusionFilter(
      { patterns: [pattern], folders: {} },
      null,
      (engine, names) =>
        seq === latestPreview
          ? ctx.deriveAutoTags(engine, names)
          : Promise.reject(superseded),
    );
    const out: PatternPreview = { status: "done", total: 0, files: [] };
    if (!filter) return out;
    try {
      for (const { core } of ctx.ws.allCores()) {
        const { total, paths } = await coveredListedFiles(
          core.db,
          core.rootId,
          filter,
          MAX_PATTERN_PREVIEW_FILES - out.files.length,
        );
        out.total += total;
        const workspace = path.basename(core.root) || core.root;
        for (const p of paths)
          out.files.push({
            workspace,
            path: p,
            absPath: path.join(core.root, ...p.split("/")),
          });
      }
    } catch (err) {
      if (err === superseded) return { status: "superseded" };
      if (err instanceof AutoTagRuleDroppedError) return { status: "timedOut" };
      throw err;
    }
    return out;
  });

  // The OS folder picker, opened at the workspace root. Only a folder inside
  // it can be excluded; the renderer lists the pick and adds it on save.
  handle("scan_exclusions_pick_folder", async ({ workspaceId }) => {
    const { root } = coreById(ctx.ws, workspaceId);
    const res = await dialog.showOpenDialog(ctx.mainWindow() ?? undefined!, {
      defaultPath: root,
      properties: ["openDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0)
      return { status: "canceled" };
    return pickedFolder(root, res.filePaths[0]);
  });
}

/** `picked` as a folder of the workspace at `root`, when it is one below it. */
export function pickedFolder(root: string, picked: string): PickedFolder {
  const rel = path.relative(root, picked);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  )
    return { status: "outside" };
  const folder = rel.split(path.sep).join("/");
  if (!isNormalizedFolderPath(folder)) return { status: "outside" };
  return { status: "picked", path: folder, absPath: path.join(root, rel) };
}

/**
 * Whether `folder` (relative, "/"-separated) is a folder under `root` now.
 * Only ever stat'ed, and only inside the root: a segment the OS splits
 * further ("a\..\.." on Windows) is not followed out of it.
 */
async function isFolder(root: string, folder: string): Promise<boolean> {
  const abs = path.join(root, ...folder.split("/"));
  const rel = path.relative(root, abs);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  )
    return false;
  try {
    return (await fsp.stat(abs)).isDirectory();
  } catch {
    return false;
  }
}
