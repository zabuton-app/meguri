// Builds GraphPayloads for the graph model tests from a compact description.
import type { GraphPayload } from "@shared/ipc/graph";
import { buildGraphology } from "../model/buildGraphology";
import type { MediaGraph } from "../model/types";

export interface FileSpec {
  ws?: string;
  path: string;
  kind?: string;
  /** Qualified tag names ("sea", "res:4k"). */
  tags?: string[];
  plays?: number;
}

export function payloadOf(files: FileSpec[]): GraphPayload {
  const p: GraphPayload = {
    workspaces: [],
    files: {
      ws: [],
      id: [],
      metaKey: [],
      relPath: [],
      kind: [],
      hasThumb: [],
      plays: [],
    },
    tags: { namespace: [], name: [] },
    edgeSets: [],
    totalFiles: files.length,
    truncated: false,
  };
  const tagIndex = new Map<string, number>();
  const a: number[] = [];
  const b: number[] = [];
  files.forEach((f, i) => {
    const ws = f.ws ?? "w";
    let wi = p.workspaces.indexOf(ws);
    if (wi < 0) wi = p.workspaces.push(ws) - 1;
    p.files.ws.push(wi);
    p.files.id.push(i + 1);
    p.files.metaKey.push(`h-${f.path}`);
    p.files.relPath.push(f.path);
    p.files.kind.push(f.kind ?? "video");
    p.files.hasThumb.push(false);
    p.files.plays.push(f.plays ?? 0);
    for (const tag of f.tags ?? []) {
      let ti = tagIndex.get(tag);
      if (ti == null) {
        const colon = tag.indexOf(":");
        ti = p.tags.name.length;
        tagIndex.set(tag, ti);
        p.tags.namespace.push(colon > 0 ? tag.slice(0, colon) : "");
        p.tags.name.push(colon > 0 ? tag.slice(colon + 1) : tag);
      }
      a.push(i);
      b.push(ti);
    }
  });
  if (a.length) p.edgeSets.push({ source: "tag", kind: "file-tag", a, b });
  return p;
}

export function graphOf(files: FileSpec[]): MediaGraph {
  return buildGraphology(payloadOf(files)).graph;
}

export const fk = (path: string, ws = "w") => `f:${ws}:h-${path}`;
export const tk = (tag: string) => {
  const colon = tag.indexOf(":");
  return colon > 0 ? `t:${tag}` : `t::${tag}`;
};
