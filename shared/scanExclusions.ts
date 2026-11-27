// What the user keeps out of scans (#282): regular expressions shared by every
// workspace, and folders excluded in one workspace. Paths are relative to the
// workspace root and "/"-separated on every platform (shared/folderPath.ts); a
// folder is matched with a trailing "/", so a pattern can target folders only.
//
// The patterns become regexes (some written by the user), so they only ever
// run in a worker (electron/core/scanExclusionFilter.ts); here they are only
// compiled, to tell the user one is wrong while it is typed.
import {
  compilePattern,
  MAX_AUTO_TAG_PATTERN,
  type TagRule,
} from "./autoTag.js";
// The IPC schema is its source of truth (.claude/rules/ipc.md).
import type { ExclusionPattern } from "./ipc/schema.js";

export type { ExclusionPattern };

/**
 * How a pattern is written (#529). Every kind becomes a regular expression
 * (patternRegex) and runs the same way; only regex takes one as written.
 *
 * - name: a file or folder name anywhere ("private", "*.tmp"), or with a
 *   "/" before its end a path from the workspace root ("work/private",
 *   "/private"); a trailing "/" takes folders only ("private/"). `*` is the
 *   only wildcard and stays within a name.
 * - contains: the text anywhere in the path.
 * - regex: a regular expression, as written.
 */
export const PATTERN_KINDS = ["name", "contains", "regex"] as const;
export type PatternKind = (typeof PATTERN_KINDS)[number];

export interface ScanExclusions {
  /** Matched case-insensitively against each path (patternRegex). */
  patterns: ExclusionPattern[];
  /** Workspace ID → excluded folders, each covering everything below it. */
  folders: Record<string, string[]>;
}

/** Most patterns kept. */
export const MAX_EXCLUSION_PATTERNS = 200;

/** Most files a pattern's preview lists (it counts them all). */
export const MAX_PATTERN_PREVIEW_FILES = 50;

/** Most folders kept per workspace. */
export const MAX_EXCLUDED_FOLDERS = 200;

export function emptyScanExclusions(): ScanExclusions {
  return { patterns: [], folders: {} };
}

/**
 * How a pattern is run: a match anywhere, even an empty one (a lookahead such
 * as `^(?!.*\.mp4$)` matches nothing but still says yes), becomes a match of
 * the first character. The auto-tag engine skips empty matches, and the path
 * a pattern is run over is never empty.
 */
const wrapPattern = (pattern: string) => `^(?=[^]*?(?:${pattern}))[^]`;

/** Longest pattern kept: what the engine takes, less the wrapping. */
export const MAX_EXCLUSION_PATTERN =
  MAX_AUTO_TAG_PATTERN - wrapPattern("").length;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A name with `*` as its only wildcard, which stays within the name. */
const nameRegex = (name: string) =>
  name.split("*").map(escapeRegExp).join("[^/]*");

/**
 * The regular expression a pattern runs as, matched against a path relative
 * to the workspace root (a folder's with a trailing "/").
 */
export function patternRegex({ kind, value }: ExclusionPattern): string {
  if (kind === "regex") return value;
  if (kind === "contains") return escapeRegExp(value);
  const raw = value.trim();
  // A "/" before the end, leading ones too, makes it a path from the root;
  // a trailing one, a folder (whose path ends with "/").
  const fromRoot = raw.replace(/\/+$/, "").includes("/");
  const folderOnly = raw.endsWith("/");
  const body = raw
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map(nameRegex)
    .join("/");
  // A whole name or path, never part of one, covering what is inside.
  return `${fromRoot ? "^" : "(^|/)"}${body}${folderOnly ? "/" : "(/|$)"}`;
}

/** Why a pattern cannot be used, or null when it can. */
export function patternError(pattern: ExclusionPattern): string | null {
  if (pattern.kind !== "regex" && pattern.value.replace(/[/*\s]/g, "") === "")
    return "empty";
  const regex = patternRegex(pattern);
  if (regex.length > MAX_EXCLUSION_PATTERN) return "too long";
  // Wrapped too, since that is what runs.
  for (const p of [regex, wrapPattern(regex)]) {
    const compiled = compilePattern(p, true);
    if ("error" in compiled) return compiled.error || "empty";
  }
  return null;
}

/** Two patterns are the same when they are of one kind and written alike. */
export const samePattern = (a: ExclusionPattern, b: ExclusionPattern) =>
  a.kind === b.kind && a.value === b.value;

/**
 * A pattern, as its regular expression (patternRegex), as an auto-tagging
 * rule, so the auto-tag worker can run it: any match gives the path a tag,
 * and a tagged path is excluded. The worker's budget and its leaving out of
 * a rule that never finishes come with it.
 */
export function exclusionRule(pattern: string): TagRule {
  return {
    id: `scan-exclusion:${pattern}`,
    name: pattern,
    kind: "regex",
    pattern: wrapPattern(pattern),
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
