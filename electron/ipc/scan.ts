import { loadConfig, updateConfig } from "../core/appConfig.js";
import { handle } from "../core/ipcHandler.js";
import {
  applyScanExclusions,
  scanExclusionFilter,
} from "../core/scanExclusionFilter.js";
import { scopedLog } from "../core/logger.js";
import { patternError } from "../../shared/scanExclusions.js";
import type { ScanExclusionsState } from "../../shared/ipc/channels.js";
import type { IpcContext } from "./context.js";

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

  // Saved, then what the patterns now cover is hidden in every workspace
  // right away, without reading the disk. A pattern taken out only lets its
  // files come back at the next scan, which reads the disk to find them.
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
    const saved = loadConfig().scanExclusions;
    if (JSON.stringify(saved.patterns) !== JSON.stringify(unique))
      throw new Error("the scan exclusions could not be saved");
    // Saved either way, so a failure from here on is not the save's: it is
    // logged, and the next scan applies the patterns (or fails, telling why).
    let hidden = 0;
    try {
      await ctx.passes.forEachWorkspace(
        () => ctx.ws.allCores(),
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
    return exclusionsState();
  });
}
