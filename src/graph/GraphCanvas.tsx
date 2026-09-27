// The WebGL surface of the graph view. Owns one sigma instance for the life of
// the component; everything that changes per interaction (colours, what is
// visible, what is focused) is read by the reducers from a ref and applied
// with a refresh, so sigma never has to be rebuilt.
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import Sigma from "sigma";
import { NodeCircleProgram } from "sigma/rendering";
import type { NodeDisplayData, PartialButFor } from "sigma/types";
import { createNodeBorderProgram } from "@sigma/node-border";
import { nodeSize } from "./model/labels";
import type { EdgeAttrs, MediaGraph, NodeAttrs } from "./model/types";
import type { Visibility } from "./model/visibility";
import type { GraphColors } from "./useGraphColors";

export interface GraphCanvasHandle {
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Centre the camera on a node, zooming in if the view is far out. */
  focus(key: string): void;
  /** Re-read positions and attributes (after the layout moved nodes). */
  refresh(): void;
}

interface Props {
  graph: MediaGraph;
  colors: GraphColors;
  visibility: Visibility;
  /** The node whose neighbourhood is highlighted (the rest is dimmed). */
  focus: string | null;
  selected: string | null;
  onHover: (key: string | null) => void;
  onClickNode: (key: string) => void;
  onDoubleClickNode: (key: string) => void;
  onClickStage: () => void;
  /** A press on a node that may become a drag; false refuses it. */
  onDragStart: (key: string) => boolean;
  /** The dragged node's new position, in graph coordinates. */
  onDrag: (key: string, x: number, y: number) => void;
  onDragEnd: (key: string) => void;
  ref?: Ref<GraphCanvasHandle>;
}

/** Past this many edges, edges are not drawn while the camera moves. */
const HIDE_EDGES_ON_MOVE_ABOVE = 10_000;
const ANIMATION_MS = 300;
/** Small graphs label every node the label grid has room for; large ones
 *  only nodes drawn at least this many pixels wide, until zoomed in. */
function labelThreshold(order: number): number {
  return order <= 500 ? 0 : 6;
}
/** Pointer travel (px) that turns a press on a node into a drag. */
const DRAG_START_PX = 4;
/** Neighbours of the focus labelled regardless of room, up to this many. */
const FORCED_LABELS_MAX = 40;

type HoverData = PartialButFor<
  NodeDisplayData,
  "x" | "y" | "size" | "label" | "color"
>;

/** Sigma's default hover card is white; draw one in the theme's colours. */
function hoverDrawer(colors: GraphColors) {
  return (
    ctx: CanvasRenderingContext2D,
    data: HoverData,
    settings: { labelSize: number; labelFont: string; labelWeight: string },
  ) => {
    if (!data.label) return;
    const size = settings.labelSize;
    ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
    const width = ctx.measureText(data.label).width;
    const pad = 4;
    const x = data.x + data.size + 3;
    const y = data.y - size / 2 - pad;
    ctx.fillStyle = colors.surface;
    ctx.beginPath();
    ctx.roundRect(x - pad, y, width + pad * 2, size + pad * 2, 4);
    ctx.fill();
    ctx.fillStyle = colors.label;
    ctx.fillText(data.label, x, data.y + size / 3);
  };
}

export function GraphCanvas({
  graph,
  colors,
  visibility,
  focus,
  selected,
  onHover,
  onClickNode,
  onDoubleClickNode,
  onClickStage,
  onDragStart,
  onDrag,
  onDragEnd,
  ref,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null);
  const [contextLost, setContextLost] = useState(false);
  if (contextLost) throw new Error("WebGL context lost");

  // What the reducers read. Updated on every render, applied by the effect
  // below; the reducers themselves are installed once.
  const state = useRef({
    graph,
    colors,
    visibility,
    focus,
    selected,
    neighbours: new Set<string>(),
  });
  const handlers = useRef({
    onHover,
    onClickNode,
    onDoubleClickNode,
    onClickStage,
    onDragStart,
    onDrag,
    onDragEnd,
  });
  useEffect(() => {
    handlers.current = {
      onHover,
      onClickNode,
      onDoubleClickNode,
      onClickStage,
      onDragStart,
      onDrag,
      onDragEnd,
    };
  });

  // One sigma for the component's life. A new graph (each payload builds one)
  // is handed over with setGraph below, keeping the camera.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const s = state.current;
    const sigma = new Sigma<NodeAttrs, EdgeAttrs>(s.graph, el, {
      allowInvalidContainer: true,
      defaultNodeType: "file",
      nodeProgramClasses: {
        file: NodeCircleProgram,
        tag: createNodeBorderProgram({
          borders: [
            { size: { value: 0.35 }, color: { attribute: "borderColor" } },
            { size: { fill: true }, color: { attribute: "color" } },
          ],
        }),
      },
      labelFont: s.colors.font,
      labelColor: { color: s.colors.label },
      labelSize: 12,
      labelDensity: 0.07,
      labelGridCellSize: 60,
      labelRenderedSizeThreshold: labelThreshold(s.graph.order),
      defaultDrawNodeHover: hoverDrawer(s.colors),
      hideEdgesOnMove: s.graph.size > HIDE_EDGES_ON_MOVE_ABOVE,
      zIndex: true,
      minCameraRatio: 0.02,
      maxCameraRatio: 4,
      nodeReducer: (key, data) => {
        const {
          colors: c,
          visibility: v,
          focus: f,
          selected: sel,
          neighbours,
        } = state.current;
        if (!v.nodes.has(key)) return { ...data, hidden: true };
        const out: Partial<NodeDisplayData> & Record<string, unknown> = {
          ...data,
          size: nodeSize(v.degree.get(key) ?? 0),
        };
        const fill =
          data.type === "tag"
            ? data.auto
              ? c.autoTag
              : c.tag
            : data.fileKind === "image"
              ? c.image
              : data.fileKind === "audio"
                ? c.audio
                : c.video;
        const lit = !f || key === f || neighbours.has(key);
        if (data.type === "tag") {
          out.borderColor = lit ? fill : c.dim;
          out.color = c.bg;
        } else {
          out.color = lit ? fill : c.dim;
        }
        if (!lit) {
          out.label = null;
          out.zIndex = 0;
        } else if (f) {
          // Every neighbour of a hub labelled at once is unreadable; past a
          // handful, sigma's label grid picks which ones fit.
          out.forceLabel = neighbours.size <= FORCED_LABELS_MAX;
          out.zIndex = 1;
        }
        if (key === sel) {
          out.highlighted = true;
          out.forceLabel = true;
          out.zIndex = 2;
        }
        return out;
      },
      edgeReducer: (key, data) => {
        const {
          graph: g,
          colors: c,
          visibility: v,
          focus: f,
          neighbours,
        } = state.current;
        if (!v.edges.has(key)) return { ...data, hidden: true };
        if (!f) return { ...data, color: c.edge, size: 0.5 };
        const [a, b] = g.extremities(key);
        // Only the focus's own links are drawn: faint copies of thousands of
        // others would bury them (and cost a draw call each).
        return a === f || b === f
          ? {
              ...data,
              color: c.edgeHighlight,
              size: neighbours.size > FORCED_LABELS_MAX ? 0.6 : 1.5,
              zIndex: 1,
            }
          : { ...data, hidden: true };
      },
    });
    sigmaRef.current = sigma;

    sigma.on("enterNode", ({ node }) => {
      el.style.cursor = "pointer";
      handlers.current.onHover(node);
    });
    sigma.on("leaveNode", () => {
      el.style.cursor = "";
      handlers.current.onHover(null);
    });
    // Dragging a node. A press alone is not a drag (a click selects): the
    // drag, and the layout run behind it, start once the pointer has moved
    // a few pixels with the left button down.
    let pressed: { node: string; x: number; y: number } | null = null;
    let dragged: string | null = null;
    // Set when a drag ends. sigma counts no movement while its default is
    // prevented, so it would take the release for a click on the node.
    let justDragged = false;
    sigma.on("downNode", ({ node, event }) => {
      justDragged = false;
      if (event.original instanceof MouseEvent && event.original.button !== 0)
        return;
      pressed = { node, x: event.x, y: event.y };
    });
    sigma.on("downStage", () => {
      justDragged = false;
    });
    sigma.on("moveBody", ({ event }) => {
      if (pressed && !dragged) {
        if (
          Math.hypot(event.x - pressed.x, event.y - pressed.y) < DRAG_START_PX
        )
          return;
        if (handlers.current.onDragStart(pressed.node)) {
          dragged = pressed.node;
          // Hold the frame still: otherwise moving a node near the edge would
          // rescale the whole view under the pointer. "Fit" lets go of it.
          if (!sigma.getCustomBBox()) sigma.setCustomBBox(sigma.getBBox());
        } else {
          pressed = null;
        }
      }
      if (!dragged) return;
      // The data changed under the drag and the node went with it.
      if (!sigma.getGraph().hasNode(dragged)) {
        endDrag();
        return;
      }
      const p = sigma.viewportToGraph(event);
      sigma.getGraph().mergeNodeAttributes(dragged, { x: p.x, y: p.y });
      handlers.current.onDrag(dragged, p.x, p.y);
      // The pointer moves the node, not the camera.
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });
    function endDrag() {
      pressed = null;
      if (!dragged) return;
      const node = dragged;
      dragged = null;
      justDragged = true;
      handlers.current.onDragEnd(node);
    }
    sigma.on("upNode", endDrag);
    sigma.on("upStage", endDrag);
    // Released outside the canvas, or the window lost focus mid-drag (the
    // release then never arrives): sigma never hears of either.
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("blur", endDrag);

    const unlessDragged =
      <T,>(fn: (e: T) => void) =>
      (e: T) => {
        if (justDragged) {
          justDragged = false;
          return;
        }
        fn(e);
      };
    sigma.on(
      "clickNode",
      unlessDragged(({ node }) => handlers.current.onClickNode(node)),
    );
    sigma.on("doubleClickNode", (e) => {
      e.preventSigmaDefault();
      if (justDragged) return;
      handlers.current.onDoubleClickNode(e.node);
    });
    sigma.on(
      "clickStage",
      unlessDragged(() => handlers.current.onClickStage()),
    );

    const canvas = el.querySelector("canvas");
    const onLost = () => setContextLost(true);
    canvas?.addEventListener("webglcontextlost", onLost);
    const resize = new ResizeObserver(() => sigma.resize());
    resize.observe(el);
    return () => {
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("blur", endDrag);
      resize.disconnect();
      canvas?.removeEventListener("webglcontextlost", onLost);
      sigma.kill();
      sigmaRef.current = null;
    };
  }, []);

  // Apply what changed since the last render. Every sigma refresh without a
  // partial graph re-indexes all of it, so settings are only touched when
  // their value changes and a new graph is not refreshed twice.
  useEffect(() => {
    const sigma = sigmaRef.current;
    const prev = state.current;
    const neighbours = new Set<string>();
    if (focus && graph.hasNode(focus)) {
      graph.forEachEdge(focus, (edge, _attrs, a, b) => {
        if (visibility.edges.has(edge)) neighbours.add(a === focus ? b : a);
      });
    }
    state.current = { graph, colors, visibility, focus, selected, neighbours };
    if (!sigma) return;
    if (prev.colors !== colors) {
      sigma.setSetting("labelColor", { color: colors.label });
      sigma.setSetting("labelFont", colors.font);
      sigma.setSetting("defaultDrawNodeHover", hoverDrawer(colors));
    }
    const hideEdges = graph.size > HIDE_EDGES_ON_MOVE_ABOVE;
    if (sigma.getSetting("hideEdgesOnMove") !== hideEdges)
      sigma.setSetting("hideEdgesOnMove", hideEdges);
    const threshold = labelThreshold(graph.order);
    if (sigma.getSetting("labelRenderedSizeThreshold") !== threshold)
      sigma.setSetting("labelRenderedSizeThreshold", threshold);
    // setGraph refreshes by itself.
    if (sigma.getGraph() !== graph) sigma.setGraph(graph);
    else sigma.refresh();
  }, [graph, colors, visibility, focus, selected]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => {
        const sigma = sigmaRef.current;
        if (!sigma) return;
        // Frame the graph as it is now, including what drags moved. The
        // frame is only recomputed on a refresh.
        sigma.setCustomBBox(null);
        sigma.refresh();
        void sigma.getCamera().animatedReset({ duration: ANIMATION_MS });
      },
      zoomIn: () =>
        void sigmaRef.current
          ?.getCamera()
          .animatedZoom({ duration: ANIMATION_MS }),
      zoomOut: () =>
        void sigmaRef.current
          ?.getCamera()
          .animatedUnzoom({ duration: ANIMATION_MS }),
      focus: (key) => {
        const sigma = sigmaRef.current;
        const data = sigma?.getNodeDisplayData(key);
        if (!sigma || !data) return;
        const camera = sigma.getCamera();
        void camera.animate(
          { x: data.x, y: data.y, ratio: Math.min(camera.ratio, 0.4) },
          { duration: ANIMATION_MS * 2 },
        );
      },
      refresh: () => sigmaRef.current?.refresh(),
    }),
    [],
  );

  return (
    <div
      ref={container}
      className="absolute inset-0"
      data-slot="graph-canvas"
    />
  );
}
