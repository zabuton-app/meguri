// Attribute shapes of the graphology graph behind the graph view. `type` is
// also sigma's program key: files draw as plain discs, tags as ringed discs.
import type Graph from "graphology";
import type { EdgeSourceId } from "@shared/ipc/graph";

export interface FileNodeAttrs {
  type: "file";
  label: string;
  x: number;
  y: number;
  /** Base size; the view recomputes it from the visible degree. */
  size: number;
  fileKind: string;
  relPath: string;
  workspaceId: string;
  fileId: number;
  hasThumb: boolean;
}

export interface TagNodeAttrs {
  type: "tag";
  label: string;
  x: number;
  y: number;
  size: number;
  namespace: string;
  name: string;
  /** Generated (res / dur / …) rather than the user's own. */
  auto: boolean;
}

export type NodeAttrs = FileNodeAttrs | TagNodeAttrs;

export interface EdgeAttrs {
  kind: EdgeSourceId;
  weight: number;
}

export type MediaGraph = Graph<NodeAttrs, EdgeAttrs>;
