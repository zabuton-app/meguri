// What the main window may show and who may call IPC: the bundled renderer, or
// the Vite dev server in development. Any other page in the window would run
// with the preload (and window.api) but without the renderer's CSP (#272).
import path from "node:path";
import { fileURLToPath } from "node:url";

let rendererIndex: string | null = null;
let devServerAllowed = false;

/**
 * The bundled renderer's index.html, and whether the dev server may stand in
 * for it. Set once at startup, before the window loads. A packaged build must
 * not allow the dev server: ELECTRON_RENDERER_URL is only an environment
 * variable, and honoring it would hand window.api to whatever page it names.
 */
export function setRendererIndex(
  file: string,
  { allowDevServer = false }: { allowDevServer?: boolean } = {},
): void {
  rendererIndex = path.resolve(file);
  devServerAllowed = allowDevServer;
}

function samePath(a: string, b: string): boolean {
  // Windows paths are case-insensitive, and the drive letter's case is not
  // guaranteed to survive the round trip through a file: URL.
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function isBundledIndex(u: URL): boolean {
  if (rendererIndex === null) return false;
  // Compared as the file it names, so no other spelling of a URL can alias it.
  // The window loads it with pathToFileURL() for the same reason: loadFile()
  // leaves a "%" in the install path unescaped, which then decodes elsewhere.
  try {
    return samePath(fileURLToPath(u), rendererIndex);
  } catch {
    return false;
  }
}

/**
 * The app itself: the bundled index.html (any hash route of it), or, when
 * allowed, the dev server's origin. The dev origin is read on each call so a
 * late-resolved ELECTRON_RENDERER_URL is honored.
 */
export function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return isBundledIndex(u);
    const dev = devServerAllowed && process.env["ELECTRON_RENDERER_URL"];
    if (dev) return u.origin === new URL(dev).origin;
    return false;
  } catch {
    return false;
  }
}
