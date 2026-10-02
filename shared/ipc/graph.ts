// Graph view payload types and shared constants. The payload only travels
// main → renderer, so it is typed rather than Zod-validated (see channels.ts).

/** Relationship kinds the graph can draw. Widened when a new source lands
 *  (e.g. "ai-similar" for embedding kNN edges). */
export type EdgeSourceId = "tag";

/** file-tag: `a` is a file index and `b` a tag index. file-file: both are file indices. */
export type EdgeKind = "file-tag" | "file-file";

/** One kind of relationship, as parallel index arrays. */
export interface EdgeSet {
  source: EdgeSourceId;
  kind: EdgeKind;
  a: number[];
  b: number[];
  /** Optional strength per edge, same length as `a` (defaults to 1). */
  weight?: number[];
}

/**
 * Everything the graph view draws for one query, column-oriented so thousands
 * of files cross IPC as a handful of arrays rather than thousands of objects.
 * File `i` is `files.<column>[i]`.
 */
export interface GraphPayload {
  /** Workspace id table; `files.ws` holds indices into it. */
  workspaces: string[];
  files: {
    ws: number[];
    id: number[];
    /** Stable across move / rename / rescan (content-hash based). */
    metaKey: string[];
    relPath: string[];
    kind: string[];
    hasThumb: boolean[];
    /** Times the file was played or viewed (its play history, all time). */
    plays: number[];
  };
  /** Unique by (namespace, name); "" is a manual tag, anything else generated. */
  tags: {
    namespace: string[];
    name: string[];
  };
  edgeSets: EdgeSet[];
  /** Files (one per workspace and meta_key, as drawn) matching the query
   *  before the cap was applied. */
  totalFiles: number;
  /** True when some matching files were left out by the cap. */
  truncated: boolean;
}

/** Files one graph shows by default; past it the view says it was cut. */
export const GRAPH_MAX_FILES = 5_000;
/** The most a caller may ask for at the IPC boundary. */
export const GRAPH_MAX_FILES_HARD = 20_000;
/** Positions one layout cache file keeps. */
export const GRAPH_LAYOUT_MAX_NODES = 40_000;
/** Length cap on a node key crossing IPC (keys embed a meta_key or tag name). */
export const GRAPH_NODE_KEY_MAX = 1024;

/** Node key of a file. meta_key rather than the file id, so a cached position
 *  survives the file being moved, renamed or rescanned. */
export function fileNodeKey(workspaceId: string, metaKey: string): string {
  return `f:${workspaceId}:${metaKey}`;
}

/** The workspace a file node key belongs to; null for a tag's key. */
export function workspaceOfNodeKey(key: string): string | null {
  if (!key.startsWith("f:")) return null;
  const end = key.indexOf(":", 2);
  return end > 2 ? key.slice(2, end) : null;
}

/** Node key of a tag. No workspace in it: the All view merges same-named tags. */
export function tagNodeKey(namespace: string, name: string): string {
  return `t:${namespace}:${name}`;
}
