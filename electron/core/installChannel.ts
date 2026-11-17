// How this copy of the app was installed, for crash reports (#544): the
// first thing a maintainer needs to reproduce one.
import path from "node:path";

export interface InstallEnv {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  /** process.windowsStore: an appx install. */
  windowsStore: boolean;
  execPath: string;
  env: Record<string, string | undefined>;
}

export function installChannel(e: InstallEnv): string {
  // Run by a stock Electron: a development build (crash reports are on there
  // only with <prefix>_CRASH_REPORTS=1), or a distribution package built
  // against the system's Electron, whose crash reports are off.
  if (!e.isPackaged) return "Built from source";
  if (e.windowsStore) return "Microsoft Store";
  if (e.platform === "win32") {
    // electron-builder's portable target sets this for the unpacked app.
    return e.env["PORTABLE_EXECUTABLE_DIR"]
      ? "GitHub Release (portable)"
      : "GitHub Release (installer)";
  }
  if (e.platform === "darwin") return "GitHub Release";
  if (e.platform === "linux") {
    // The AppImage runtime sets this; the AUR's -bin package runs the
    // AppImage's contents unpacked under /opt/<package>, without it.
    if (e.env["APPIMAGE"]) return "GitHub Release (AppImage)";
    const dir = path.posix.dirname(e.execPath);
    if (dir.startsWith("/opt/") && dir.endsWith("-bin")) {
      return `AUR (${path.posix.basename(dir)})`;
    }
    // electron-builder's deb installs under /opt/<productName>.
    if (dir.startsWith("/opt/")) return "GitHub Release (deb)";
  }
  return "Other";
}
