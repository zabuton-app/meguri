// Attribute shapes of the graphology graph behind the graph view. `type` is
// also sigma's program key (both draw as discs).
import type Graph from "graphology";
import type { EdgeSourceId } from "@shared/ipc/graph";

export interface FileNodeAttrs {
  type: "file";
  label: string;
  x: number;
  y: number;
  /** A placeholder; the view sizes nodes by their visible links. */
  size: number;
  fileKind: string;
  relPath: string;
  workspaceId: string;
  fileId: number;
  hasThumb: boolean;
  /** Times played or viewed. */
  plays: number;
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
