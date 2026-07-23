// `relPath` comes from the main process via path.relative(), so its separator
// is platform-dependent: "/" on Linux/macOS, "\" on Windows. Split on both.
export function fileNameOf(relPath: string): string {
  return relPath.split(/[\\/]/).pop() || relPath;
}
