// Barrel re-export. The implementations are split by responsibility under ./queries/.
// Existing callers `import * as q from "./queries.js"` keep working unchanged.
export * from "./queries/files.js";
export * from "./queries/meta.js";
export * from "./queries/bookmarks.js";
export * from "./queries/thumbs.js";
export * from "./queries/scanRoots.js";
export * from "./queries/history.js";
export * from "./queries/duplicates.js";
export * from "./queries/settings.js";
export * from "./queries/folderRange.js";
export * from "./queries/folders.js";
export * from "./queries/graph.js";
export * from "./queries/activity.js";
