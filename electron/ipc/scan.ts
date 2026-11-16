import fsp from "node:fs/promises";
import path from "node:path";
import { loadConfig, updateConfig } from "../core/appConfig.js";
import { handle } from "../core/ipcHandler.js";
import {
  applyScanExclusions,
  scanExclusionFilter,
} from "../core/scanExclusionFilter.js";
import { scopedLog } from "../core/logger.js";
import {
  MAX_EXCLUDED_FOLDERS,
  patternError,
} from "../../shared/scanExclusions.js";
import type {
  ExcludedFolders,
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
    const unique = [...new Set(patterns)];
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

  /** The workspace's excluded folders, and whether each is on disk now. */
  const excludedFolders = async (
    workspaceId: string,
  ): Promise<ExcludedFolders> => {
    const { root } = coreById(ctx.ws, workspaceId);
    const paths = loadConfig().scanExclusions.folders[workspaceId] ?? [];
    return {
      folders: await Promise.all(
        paths.map(async (p) => ({ path: p, found: await isFolder(root, p) })),
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

  // The files under the folders come back at the next scan, which reads the
  // disk to find them.
  handle("scan_exclusions_remove_folders", ({ workspaceId, paths }) => {
    coreById(ctx.ws, workspaceId);
    const removed = new Set(paths);
    saveFolders(workspaceId, (current) =>
      current.filter((f) => !removed.has(f)),
    );
    return excludedFolders(workspaceId);
  });
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
