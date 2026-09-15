import { dialog } from "electron";
import { handle } from "../core/ipcHandler.js";
import {
  ALL_ID,
  HOME_ID,
  COLLECTION_ID_PREFIX,
  Workspaces,
} from "../core/workspaces.js";
import type { IpcContext } from "./context.js";

export function registerWorkspaceHandlers(ctx: IpcContext): void {
  const { ws, queryClient, emit } = ctx;

  handle("workspaces_list", () => ({
    workspaces: ws.list(),
    collections: ws.collections(),
    activeId: ws.activeId,
  }));

  handle("workspace_add", async () => {
    const res = await dialog.showOpenDialog(ctx.mainWindow() ?? undefined!, {
      title: "Add video directory",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) return { added: false };
    const np = ws.add(res.filePaths[0]);
    ws.setActive(np);
    const scanJobId = ctx.scans.start();
    emit("workspace:changed", { activeId: ws.activeId });
    return { added: true, id: Workspaces.idFor(np), scanJobId };
  });

  handle("workspace_remove", async ({ id }) => {
    const p = ws.pathOf(id);
    if (p) {
      await ctx.scans.abort(id);
      // The worker holds a read-only handle on this workspace's DB; close it
      // before ws.remove() deletes the data dir (open handles block removal
      // on Windows).
      await queryClient.closeWorkspace(id);
      ws.remove(p);
    }
    if (ws.active()) ctx.scans.start();
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("workspace_reorder", ({ ids }) => {
    ws.reorder(ids);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("workspace_switch", ({ id }) => {
    if (id === ALL_ID || id === HOME_ID) {
      ws.setActive(id); // the virtual "All" / "Home" views are never scanned
      emit("workspace:changed", { activeId: ws.activeId });
      return;
    }
    if (id.startsWith(COLLECTION_ID_PREFIX)) {
      ws.setActive(id);
      emit("workspace:changed", { activeId: ws.activeId });
      return;
    }
    const p = ws.pathOf(id);
    if (p) ws.setActive(p);
    ctx.scans.start();
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_create", ({ name, emoji }) => {
    const collection = ws.addCollection(name, emoji);
    emit("workspace:changed", { activeId: ws.activeId });
    // addCollection makes the new collection active, so it's always the active one here.
    // User-created collections are never locked; only the built-in Watch Later is.
    return { ...collection, active: true, locked: false };
  });

  handle("collection_remove", ({ id }) => {
    ws.removeCollection(id);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_reorder", ({ ids }) => {
    ws.reorderCollections(ids);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_reorder_items", ({ collectionId, items }) => {
    ws.reorderCollectionItems(collectionId, items);
    // Deliberately no workspace:changed broadcast. The rail listens for it by
    // invalidating every files_search, which would refetch the pages the
    // renderer just patched optimistically — on every single drop. Nothing in
    // the rail depends on the order within a collection, and the renderer
    // refetches itself if the write fails. Same reasoning as removeFromWatchLater.
  });

  handle("collection_set_emoji", ({ id, emoji }) => {
    ws.setCollectionEmoji(id, emoji);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_rename", ({ id, name }) => {
    ws.renameCollection(id, name);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("workspace_set_emoji", ({ id, emoji }) => {
    ws.setWorkspaceEmoji(id, emoji);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_add_file", ({ collectionId, workspaceId, id }) => {
    ws.addToCollection(collectionId, workspaceId, id);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("collection_remove_file", ({ collectionId, workspaceId, id }) => {
    ws.removeFromCollection(collectionId, workspaceId, id);
    emit("workspace:changed", { activeId: ws.activeId });
  });
}
