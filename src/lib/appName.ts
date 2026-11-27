// The app's name, handed down by the preload (window.api.appName). The main
// process decides it (startApp() in electron/app.ts), so the renderer's text
// never spells it out: locale strings use {app}, which t() fills in.
export function appName(): string {
  return window.api?.appName ?? "";
}

/** The app's one-character mark (Meguri's is 巡), for where a name is too long. */
export function appGlyph(): string {
  return window.api?.appGlyph ?? "";
}
