// Resolve the storage location for artifacts (DB and thumbnails).
// Centralized under the app userData directory, with one hashed folder per scan root.
import { app } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The app's base data directory. Uses Electron's userData. */
export function baseDataDir(): string {
  // e.g. Linux ~/.config/Meguri → unified under userData here.
  return app.getPath("userData");
}

/** Stable hash of a scan root path (hex). */
export function pathHash(p: string): string {
  return createHash("sha1").update(p).digest("hex").slice(0, 16);
}

/** The artifacts directory corresponding to a root. */
export function dataDirForRoot(root: string): string {
  return path.join(baseDataDir(), "roots", pathHash(root));
}

/**
 * Whether an absolute path lies inside (or is equal to) a normalized root directory.
 * Plain `abs.startsWith(root)` would let "/home/u/videos2/x" match root "/home/u/videos".
 * Symlinks are resolved so a path under root that points outside is rejected.
 * Drive-root edge case ("C:\\") already ends with a separator, so don't double up.
 */
export function isInsideRoot(abs: string, root: string): boolean {
  let normalizedAbs: string;
  let normalizedRoot: string;
  try {
    normalizedAbs = fs.realpathSync(abs);
    normalizedRoot = fs.realpathSync(root);
  } catch {
    return false;
  }
  if (normalizedAbs === normalizedRoot) return true;
  const prefix = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  return normalizedAbs.startsWith(prefix);
}
