// Whether the tests may create symlinks. Kept free of DB and Electron imports
// so a test that mocks "electron" can read it without pulling the core in.
// Not a test file itself (no ".test" suffix).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Windows grants the symlink privilege only to an administrator or in
 * Developer Mode, so an ordinary local run skips the symlink cases rather than
 * failing on EPERM; CI's runner, which has it, still covers them (#297).
 * Probed once: the answer cannot change mid-run.
 */
export const CAN_SYMLINK = ((): boolean => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-symlink-probe-"));
  try {
    fs.symlinkSync(path.join(dir, "target"), path.join(dir, "link"));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

/**
 * Link a directory, unprivileged. Windows needs the symlink privilege for a
 * directory symlink but not for a junction, which realpath resolves the same
 * way, so a case about where a directory link leads runs on an ordinary
 * Windows machine rather than waiting for CI (#297). `target` must be
 * absolute: a junction stores no relative path.
 */
export function linkDirSync(target: string, linkPath: string): void {
  if (!path.isAbsolute(target)) {
    throw new Error(`linkDirSync needs an absolute target, got ${target}`);
  }
  fs.symlinkSync(
    target,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
}
