// `relPath` comes from the main process via path.relative(), so its separator
// is platform-dependent: "/" on Linux/macOS, "\" on Windows. Split on both.
export function fileNameOf(relPath: string): string {
  return relPath.split(/[\\/]/).pop() || relPath;
}

/** Keep dots within the name; only split the final suffix, never a dotfile's leading dot. */
export function fileNameParts(relPath: string): {
  name: string;
  extension: string;
} {
  const fullName = fileNameOf(relPath);
  const dot = fullName.lastIndexOf(".");
  return dot > 0 && dot < fullName.length - 1
    ? { name: fullName.slice(0, dot), extension: fullName.slice(dot) }
    : { name: fullName, extension: "" };
}

/** The folder part of a relative path, "" for a file at the workspace root. */
export function dirOf(relPath: string): string {
  const i = Math.max(relPath.lastIndexOf("/"), relPath.lastIndexOf("\\"));
  return i < 0 ? "" : relPath.slice(0, i);
}

/**
 * The folder holding a file, in the "/"-separated form the folder view names
 * folders by (shared/folderPath.ts): "" for a file at the workspace root.
 */
export function folderPathOf(relPath: string): string {
  return dirOf(relPath).split(/[\\/]/).join("/");
}
