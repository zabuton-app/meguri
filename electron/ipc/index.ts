// IPC handler registration, one module per domain. app.ts builds the
// IpcContext and calls registerIpc() once the app is ready; adding a channel
// means adding a handle() to the matching group here (see docs/architecture.md).
import type { IpcContext } from "./context.js";
import { registerActivityHandlers } from "./activity.js";
import { registerAutoTagHandlers } from "./autoTag.js";
import { registerBookmarkHandlers } from "./bookmarks.js";
import { registerCrashReportHandlers } from "./crashReports.js";
import { registerCssThemeHandlers } from "./cssThemes.js";
import { registerCustomCssHandlers } from "./customCss.js";
import { registerFileHandlers } from "./files.js";
import { registerFolderHandlers } from "./folders.js";
import { registerGraphHandlers } from "./graph.js";
import { registerLogoHandlers } from "./logo.js";
import { registerNoteTemplateHandlers } from "./noteTemplate.js";
import { registerScanHandlers } from "./scan.js";
import { registerShellHandlers } from "./shell.js";
import { registerSmartCollectionHandlers } from "./smartCollections.js";
import { registerStatusHandlers } from "./status.js";
import { registerTagHandlers } from "./tags.js";
import { registerThumbHandlers } from "./thumbs.js";
import { registerTimelineHandlers } from "./timeline.js";
import { registerUpdateHandlers } from "./updates.js";
import { registerWindowHandlers } from "./window.js";
import { registerWorkspaceHandlers } from "./workspaces.js";

export type { IpcContext } from "./context.js";

export function registerIpc(ctx: IpcContext): void {
  registerStatusHandlers(ctx);
  registerWorkspaceHandlers(ctx);
  registerScanHandlers(ctx);
  registerFileHandlers(ctx);
  registerFolderHandlers(ctx);
  registerGraphHandlers(ctx);
  registerActivityHandlers(ctx);
  registerTimelineHandlers(ctx);
  registerTagHandlers(ctx);
  registerAutoTagHandlers(ctx);
  registerBookmarkHandlers(ctx);
  registerThumbHandlers(ctx);
  registerShellHandlers(ctx);
  registerWindowHandlers(ctx);
  registerUpdateHandlers();
  registerCrashReportHandlers(ctx);
  registerLogoHandlers(ctx);
  registerNoteTemplateHandlers();
  registerCustomCssHandlers(ctx);
  registerCssThemeHandlers(ctx);
  registerSmartCollectionHandlers();
}
