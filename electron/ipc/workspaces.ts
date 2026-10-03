import { dialog } from "electron";
import { handle } from "../core/ipcHandler.js";
import {
  ALL_ID,
  COLLECTION_ID_PREFIX,
  Workspaces,
} from "../core/workspaces.js";
import {
  collectionLayoutPaths,
  removeLayout,
  removeWorkspaceWithLayouts,
} from "../core/graph/layoutCache.js";
import {
  baseDataDir,
  dataDirForRoot,
  droppedDirectory,
} from "../core/paths.js";
import type { WorkspaceAddResult } from "../../shared/ipc/channels.js";
import type { IpcContext } from "./context.js";
import { bulkTargetCores } from "./helpers.js";

export function registerWorkspaceHandlers(ctx: IpcContext): void {
  const { ws, queryClient, emit } = ctx;

  handle("workspaces_list", () => ({
    workspaces: ws.list(),
    collections: ws.collections(),
    activeId: ws.activeId,
  }));

  // Register a folder, make it active and start its scan. Shared by the picker
  // and by a folder dropped from the OS, so the two cannot drift apart.
  const register = (dir: string): WorkspaceAddResult => {
    // addRoot() reports whether the folder was new itself: it matches an
    // existing root case-insensitively on Windows, which comparing ids (a hash)
    // would not.
    const { path: np, added } = ws.addRoot(dir);
    const existing = !added;
    ws.setActive(np);
    const scanJobId = ctx.scans.start();
    emit("workspace:changed", { activeId: ws.activeId });
    return { added: true, id: Workspaces.idFor(np), scanJobId, existing };
  };

  handle("workspace_add", async () => {
    const res = await dialog.showOpenDialog(ctx.mainWindow() ?? undefined!, {
      title: "Add video directory",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) return { added: false };
    return register(res.filePaths[0]);
  });

  // A folder dropped onto the window. The preload resolved the path from the
  // dropped File; it is re-checked here, since only main can tell a directory
  // from a file, and a file must never become a workspace.
  handle("workspace_add_path", async ({ path }) => {
    const dir = await droppedDirectory(path);
    if (!dir) return { added: false, notDirectory: true };
    return register(dir);
  });

  handle("workspace_remove", async ({ id }) => {
    const p = ws.pathOf(id);
    if (p) {
      await ctx.scans.abort(id);
      // A graph layout save must not write into the data dir as it is
      // deleted, nor bring it back after.
      await removeWorkspaceWithLayouts(dataDirForRoot(p), async () => {
        // The worker holds a read-only handle on this workspace's DB; close
        // it before ws.remove() deletes the data dir (open handles block
        // removal on Windows), with nothing awaited in between that would
        // let a query open it again.
        await queryClient.closeWorkspace(id);
        ws.remove(p);
      });
    }
    if (ws.active()) ctx.scans.start();
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("workspace_reorder", ({ ids }) => {
    ws.reorder(ids);
    emit("workspace:changed", { activeId: ws.activeId });
  });

  handle("workspace_switch", ({ id }) => {
    if (id === ALL_ID) {
      ws.setActive(ALL_ID); // the virtual "All" view is never scanned
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
    // The graph view's cached positions go with the collection (a
    // workspace's layouts live in its data directory, which removal deletes
    // anyway); a locked or unknown one stays, and so do they.
    if (ws.removeCollection(id))
      for (const file of collectionLayoutPaths(baseDataDir(), id))
        void removeLayout(file);
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

  // Membership for a whole selection in one config write, and one event: the
  // renderer refetches the workspace list off that, so emitting per file would
  // make it refetch once per file.
  //
  // The targets are resolved first even though nothing here reads a database:
  // collection items are written to config.json, which is the user's settings
  // file, so an id that names no workspace must not be able to put an entry in
  // it that nothing can ever resolve or clean up.
  handle("collection_set_membership", ({ collectionId, targets, op }) => {
    const files = bulkTargetCores(ws, targets).flatMap(
      ({ workspaceId, fileIds }) =>
        fileIds.map((fileId) => ({ workspaceId, fileId })),
    );
    const changed = ws.updateCollectionMembership(collectionId, files, op);
    if (changed > 0) emit("workspace:changed", { activeId: ws.activeId });
    return { changed };
  });
}
