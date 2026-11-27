import {
  addSmartCollection,
  importSmartCollections,
  listSmartCollections,
  removeSmartCollection,
  setDefaultSmartCollection,
} from "../core/smartCollectionStore.js";
import { handle } from "../core/ipcHandler.js";

export function registerSmartCollectionHandlers(): void {
  handle("smart_collections_list", () => listSmartCollections());
  handle("smart_collections_import", ({ collections, defaultId }) =>
    importSmartCollections(collections, defaultId),
  );
  handle("smart_collection_add", ({ collection }) =>
    addSmartCollection(collection),
  );
  handle("smart_collection_remove", ({ id }) => removeSmartCollection(id));
  handle("smart_collection_set_default", ({ id }) =>
    setDefaultSmartCollection(id),
  );
}
