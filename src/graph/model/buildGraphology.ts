// Turns a GraphPayload into a graphology graph. Each payload gets a fresh
// graph, built before sigma sees it: sigma v3 re-indexes the whole graph on
// every dropped node or edge, so trimming the shown graph in place after a
// filter change would freeze the view for seconds. Positions carry over from
// the previous graph by key; new nodes start at (0, 0) for placement.ts.
import Graph from "graphology";
import { fileNodeKey, tagNodeKey, type GraphPayload } from "@shared/ipc/graph";
import { qualifiedTagName } from "@shared/tags";
import { fileNameOf } from "@/lib/relPath";
import type { MediaGraph } from "./types";

export function emptyGraph(): MediaGraph {
  return new Graph({ type: "undirected", multi: false });
}

/** Unambiguous whatever the node keys contain (paths and tag names are free text). */
export function edgeKey(kind: string, a: string, b: string): string {
  return JSON.stringify([kind, a, b]);
}

export interface BuiltGraph {
  graph: MediaGraph;
  /** Nodes that were not in `prev` (their position is still to be decided). */
  added: string[];
}

export function buildGraphology(
  payload: GraphPayload,
  prev: MediaGraph | null = null,
): BuiltGraph {
  const graph = emptyGraph();
  const added: string[] = [];
  const { files, tags } = payload;
  const position = (key: string): { x: number; y: number } => {
    if (prev?.hasNode(key)) {
      const { x, y } = prev.getNodeAttributes(key);
      return { x, y };
    }
    added.push(key);
    return { x: 0, y: 0 };
  };

  const fileKeys = files.id.map((id, i) => {
    const workspaceId = payload.workspaces[files.ws[i]];
    const key = fileNodeKey(workspaceId, files.metaKey[i]);
    if (!graph.hasNode(key)) {
      graph.addNode(key, {
        type: "file",
        label: fileNameOf(files.relPath[i]),
        ...position(key),
        size: 1,
        fileKind: files.kind[i],
        relPath: files.relPath[i],
        workspaceId,
        fileId: id,
        hasThumb: files.hasThumb[i],
        plays: files.plays[i] ?? 0,
      });
    }
    return key;
  });
  const tagKeys = tags.name.map((name, i) => {
    const namespace = tags.namespace[i];
    const key = tagNodeKey(namespace, name);
    if (!graph.hasNode(key)) {
      graph.addNode(key, {
        type: "tag",
        label: qualifiedTagName(namespace, name),
        ...position(key),
        size: 1,
        namespace,
        name,
        auto: namespace !== "",
      });
    }
    return key;
  });

  for (const set of payload.edgeSets) {
    const bKeys = set.kind === "file-tag" ? tagKeys : fileKeys;
    for (let i = 0; i < set.a.length; i++) {
      const a = fileKeys[set.a[i]];
      const b = bKeys[set.b[i]];
      if (a == null || b == null || a === b) continue;
      const key = edgeKey(set.source, a, b);
      if (graph.hasEdge(key)) continue;
      graph.addUndirectedEdgeWithKey(key, a, b, {
        kind: set.source,
        weight: set.weight?.[i] ?? 1,
      });
    }
  }
  return { graph, added };
}
