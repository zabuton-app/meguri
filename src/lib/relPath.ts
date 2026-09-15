// `relPath` comes from the main process via path.relative(), so its separator
// is platform-dependent: "/" on Linux/macOS, "\" on Windows. Split on both.
export function fileNameOf(relPath: string): string {
  return relPath.split(/[\\/]/).pop() || relPath;
}

/** The folder part of a relPath ("" for a file at the root), separators kept as given. */
export function folderOf(relPath: string): string {
  const i = Math.max(relPath.lastIndexOf("/"), relPath.lastIndexOf("\\"));
  return i === -1 ? "" : relPath.slice(0, i);
}
