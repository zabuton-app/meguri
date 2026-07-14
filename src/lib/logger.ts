// Renderer-side logger. Forwards to electron-log/main over IPC via the
// `electron-log/preload` bridge installed in preload.ts, so renderer messages
// land in the same rotated file as the main process (<userData>/logs/main.log).
//
// Use this instead of console.* for anything that should survive a reload or
// be readable in a packaged build.
import log from "electron-log/renderer";

export default log;
