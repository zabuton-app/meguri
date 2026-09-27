// Which nodes and edges the view shows, given the toggles and the local-graph
// focus. Computed when those change (not per hover), and applied through
// sigma's reducers, so the graph itself and the running layout are untouched.
import type { EdgeSourceId } from "@shared/ipc/graph";
import type { EdgeAttrs, MediaGraph } from "./types";

export interface VisibilityOptions {
  /** Relationship kinds switched on; a kind missing from the record is on. */
  edgeSources: Partial<Record<EdgeSourceId, boolean>>;
  showAutoTags: boolean;
  showOrphans: boolean;
}

export interface LocalFocus {
  node: string;
  depth: number;
}

export interface Visibility {
  nodes: Set<string>;
  edges: Set<string>;
  /** Degree counted over the visible edges only (sizes, hubs, the overview). */
  degree: Map<string, number>;
}

export function visibleSet(
  graph: MediaGraph,
  options: VisibilityOptions,
  local: LocalFocus | null = null,
): Visibility {
  const nodeAllowed = (key: string): boolean => {
    const attrs = graph.getNodeAttributes(key);
    return attrs.type !== "tag" || !attrs.auto || options.showAutoTags;
  };
  const edgeAllowed = (attrs: EdgeAttrs, a: string, b: string): boolean =>
    options.edgeSources[attrs.kind] !== false &&
    nodeAllowed(a) &&
    nodeAllowed(b);

  const edges = new Set<string>();
  const degree = new Map<string, number>();
  graph.forEachEdge((key, attrs, a, b) => {
    if (!edgeAllowed(attrs, a, b)) return;
    edges.add(key);
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  });

  const nodes = new Set<string>();
  graph.forEachNode((key, attrs) => {
    if (!nodeAllowed(key)) return;
    const d = degree.get(key) ?? 0;
    // A tag is only there to connect files; one with nothing to connect
    // (every link switched off) is noise. A file without links is an orphan.
    if (d === 0 && (attrs.type === "tag" || !options.showOrphans)) return;
    nodes.add(key);
  });

  if (!local || !nodes.has(local.node)) return { nodes, edges, degree };

  // Breadth-first from the focus, over the edges that are showing.
  const reached = new Set([local.node]);
  let frontier = [local.node];
  for (let d = 0; d < local.depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const key of frontier) {
      graph.forEachEdge(key, (edge, _attrs, a, b) => {
        if (!edges.has(edge)) return;
        const other = a === key ? b : a;
        if (reached.has(other) || !nodes.has(other)) return;
        reached.add(other);
        next.push(other);
      });
    }
    frontier = next;
  }
  const localEdges = new Set<string>();
  for (const edge of edges) {
    const [a, b] = graph.extremities(edge);
    if (reached.has(a) && reached.has(b)) localEdges.add(edge);
  }
  return { nodes: reached, edges: localEdges, degree };
}
