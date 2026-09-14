// IPC handler registration, one module per domain. main.ts builds the
// IpcContext and calls registerIpc() once the app is ready; adding a channel
// means adding a handle() to the matching group here (see docs/architecture.md).
import type { IpcContext } from "./context.js";
import { registerBookmarkHandlers } from "./bookmarks.js";
import { registerFileHandlers } from "./files.js";
import { registerLogoHandlers } from "./logo.js";
import { registerScanHandlers } from "./scan.js";
import { registerShellHandlers } from "./shell.js";
import { registerStatusHandlers } from "./status.js";
import { registerTagHandlers } from "./tags.js";
import { registerThumbHandlers } from "./thumbs.js";
import { registerUpdateHandlers } from "./updates.js";
import { registerWorkspaceHandlers } from "./workspaces.js";

export type { IpcContext, ScanOptions } from "./context.js";

export function registerIpc(ctx: IpcContext): void {
  registerStatusHandlers(ctx);
  registerWorkspaceHandlers(ctx);
  registerScanHandlers(ctx);
  registerFileHandlers(ctx);
  registerTagHandlers(ctx);
  registerBookmarkHandlers(ctx);
  registerThumbHandlers(ctx);
  registerShellHandlers(ctx);
  registerUpdateHandlers();
  registerLogoHandlers(ctx);
}
