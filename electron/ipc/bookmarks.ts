import { handle } from "../core/ipcHandler.js";
import * as q from "../core/queries.js";
import type { IpcContext } from "./context.js";
import { coreById } from "./helpers.js";

export function registerBookmarkHandlers(ctx: IpcContext): void {
  const { ws } = ctx;

  handle("bookmark_add", ({ id, workspaceId, sec }) =>
    q.addBookmark(coreById(ws, workspaceId).db, id, sec),
  );
  handle("bookmark_remove", ({ id, workspaceId, bookmarkId }) =>
    q.removeBookmark(coreById(ws, workspaceId).db, id, bookmarkId),
  );
}
