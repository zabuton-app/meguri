// What the user keeps out of scans (#282): regular expressions shared by every
// workspace, and folders excluded in one workspace. Paths are relative to the
// workspace root and "/"-separated on every platform (shared/folderPath.ts); a
// folder is matched with a trailing "/", so a pattern can target folders only.
//
// The patterns are user regexes, so they only ever run in a worker
// (electron/core/scanExclusionFilter.ts); here they are only compiled, to tell
// the user one is wrong while it is typed.
import { compilePattern, type TagRule } from "./autoTag.js";

export interface ScanExclusions {
  /** Regular expressions, matched case-insensitively anywhere in the path. */
  patterns: string[];
  /** Workspace ID → excluded folders, each covering everything below it. */
  folders: Record<string, string[]>;
}

/** Most patterns kept. */
export const MAX_EXCLUSION_PATTERNS = 200;

export function emptyScanExclusions(): ScanExclusions {
  return { patterns: [], folders: {} };
}

/** Why a pattern cannot be used, or null when it compiles. */
export function patternError(pattern: string): string | null {
  const compiled = compilePattern(pattern, true);
  return "error" in compiled ? compiled.error || "empty" : null;
}

/**
 * A pattern as an auto-tagging rule, so the auto-tag worker can run it: any
 * match gives the path a tag, and a tagged path is excluded. The worker's
 * budget and its leaving out of a rule that never finishes come with it.
 */
export function exclusionRule(pattern: string): TagRule {
  return {
    id: `scan-exclusion:${pattern}`,
    name: pattern,
    kind: "regex",
    pattern,
    template: "excluded",
    exclude: "",
    ci: true,
    split: false,
    caseMode: "keep",
    enabled: true,
  };
}

/**
 * What an exclusion rule is run over for a path. The engine matches a file
 * name without its extension (stripExt), which a path's own extension must
 * not lose: `\.part$` has to see it. A suffix stripExt takes off is added
 * so that what is matched is the path exactly, with a folder's "/".
 */
export function exclusionSubject(relPath: string, isDir: boolean): string {
  return `${isDir ? `${relPath}/` : relPath}.ex`;
}

/**
 * Whether one of the workspace's excluded folders covers a path: the folder
 * itself (when the path is one) or a folder above it.
 */
export function inExcludedFolder(
  folders: ReadonlySet<string>,
  relPath: string,
  isDir: boolean,
): boolean {
  if (folders.size === 0) return false;
  let at = isDir ? relPath.length : relPath.lastIndexOf("/");
  while (at > 0) {
    if (folders.has(relPath.slice(0, at))) return true;
    at = relPath.lastIndexOf("/", at - 1);
  }
  return false;
}
