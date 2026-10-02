// Where the graph's relationships come from. Each source turns a workspace's
// files into edges; the graph builder merges them across workspaces. Adding a
// relationship (e.g. AI similarity as weighted file-file edges) is one more
// entry in EDGE_SOURCES and a wider EdgeSourceId, then the renderer's side:
// see docs/architecture.md, "Graph view", for the steps. The payload already
// carries kinds and weights; the simulation uses links, not their weights.
import type { DB } from "../db.js";
import type { EdgeKind, EdgeSourceId } from "../../../shared/ipc/graph.js";

/** Edges one source found among one workspace's files, by local index. */
export interface EdgeSourceResult {
  kind: EdgeKind;
  /** Tags this source introduces (file-tag only); `b` indexes into it. */
  tags: { namespace: string; name: string }[];
  /** Index into the `metaKeys` the source was given. */
  a: number[];
  /** Index into `tags` (file-tag) or `metaKeys` (file-file). */
  b: number[];
  weight?: number[];
}

/**
 * One kind of relationship. `build` sees one workspace's database and files,
 * so it can link files within a workspace (and to tags, merged by name across
 * workspaces); links between files of different workspaces would need the
 * builder to hand a source every workspace at once. On the renderer side a
 * new kind also needs its row in EDGE_SOURCE_INFO and, to look different from
 * tag links, its style in GraphCanvas's edge reducer.
 */
export interface EdgeSource {
  id: EdgeSourceId;
  /** `metaKeys` are unique; edges must not repeat an (a, b) pair. */
  build(db: DB, metaKeys: string[]): EdgeSourceResult;
}

/** File—tag links from meta_tags. A tag attached by several sources (manual
 *  and generated, say) is still one link, hence DISTINCT. */
export const tagEdgeSource: EdgeSource = {
  id: "tag",
  build(db, metaKeys) {
    const result: EdgeSourceResult = {
      kind: "file-tag",
      tags: [],
      a: [],
      b: [],
    };
    if (metaKeys.length === 0) return result;
    const rows = db
      .prepare(
        `SELECT DISTINCT mt.meta_key AS metaKey, t.namespace, t.name
           FROM meta_tags mt JOIN tags t ON t.id = mt.tag_id
          WHERE mt.meta_key IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(metaKeys)) as {
      metaKey: string;
      namespace: string;
      name: string;
    }[];
    const fileIndex = new Map(metaKeys.map((k, i) => [k, i]));
    const tagIndex = new Map<string, number>();
    for (const row of rows) {
      const a = fileIndex.get(row.metaKey);
      if (a == null) continue;
      const key = `${row.namespace}\u0000${row.name}`;
      let b = tagIndex.get(key);
      if (b == null) {
        b = result.tags.length;
        tagIndex.set(key, b);
        result.tags.push({ namespace: row.namespace, name: row.name });
      }
      result.a.push(a);
      result.b.push(b);
    }
    return result;
  },
};

export const EDGE_SOURCES: readonly EdgeSource[] = [tagEdgeSource];
