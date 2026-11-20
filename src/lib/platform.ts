// The OS the app runs on, handed down by the preload (window.api.platform):
// "darwin", "win32", "linux", …, or "" without the preload (tests).
export function platform(): string {
  return window.api?.platform ?? "";
}
