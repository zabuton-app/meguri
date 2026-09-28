// The WebGL surface of the graph view, drawn the way Obsidian draws its graph.
// Owns one sigma instance for the life of the component; everything that
// changes per interaction (colours, what is visible, what is focused) is read
// by the reducers from a ref and applied with a refresh.
//
// Graph coordinates are the simulation's, framed by a fixed box, so the camera
// works like Obsidian's: `scale` (pixels per graph unit) is s1 / camera ratio.
// Nodes are circles of radius clamp(3·√(links + 1), 8, 30) graph units drawn
// at √scale (they shrink slower than the graph when zooming out), links are a
// constant number of pixels wide, and labels sit under their node and fade in
// as the view zooms past a threshold.
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import Sigma from "sigma";
import { NodeCircleProgram } from "sigma/rendering";
import type {
  CameraState,
  EdgeDisplayData,
  NodeDisplayData,
  PartialButFor,
} from "sigma/types";
import type { DisplaySettings } from "./graphSettings";
import { fade, nodeRadius } from "./model/appearance";
import type { EdgeAttrs, MediaGraph, NodeAttrs } from "./model/types";
import type { Visibility } from "./model/visibility";
import type { GraphColors } from "./useGraphColors";

export interface GraphCanvasHandle {
  /** Frame the visible nodes. */
  fit(animate?: boolean): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Centre the camera on a node, zooming in to where labels show. */
  focus(key: string): void;
}

interface Props {
  graph: MediaGraph;
  colors: GraphColors;
  visibility: Visibility;
  /** The node whose neighbourhood is highlighted (the rest fades). */
  focus: string | null;
  display: DisplaySettings;
  onHover: (key: string | null) => void;
  onClickNode: (key: string) => void;
  onClickStage: () => void;
  /** A press on a node became a drag; false refuses it. */
  onDragStart: (key: string) => boolean;
  /** The dragged node's new position, in graph coordinates. */
  onDrag: (key: string, x: number, y: number) => void;
  onDragEnd: (key: string) => void;
  /** The user moved the camera (wheel, pan, zoom buttons). */
  onCameraInput?: () => void;
  ref?: Ref<GraphCanvasHandle>;
}

/** Past this many edges, edges are not drawn while the camera moves. */
const HIDE_EDGES_ON_MOVE_ABOVE = 10_000;
/** The graph-coordinate box sigma frames; fixed, so the view never rescales
 *  itself as the simulation spreads the graph out. */
const FRAME: { x: [number, number]; y: [number, number] } = {
  x: [-500, 500],
  y: [-500, 500],
};
/** Zoom range, as Obsidian's scale (pixels per graph unit). */
const MIN_SCALE = 1 / 128;
const MAX_SCALE = 8;
/** Wheel zoom: the scale changes by this factor per notch (120 delta units). */
const WHEEL_STEP = 1.5;
/** Share of the remaining zoom left after each frame of the zoom animation. */
const ZOOM_EASE = 0.85;
const ANIMATION_MS = 300;
/** Pointer travel (px) that turns a press on a node into a drag. */
const DRAG_START_PX = 5;
/** Opacity of what is not next to the focused node. */
const FADED = 0.2;
/** Gap between a node and the label under it, in graph units (drawn at √scale
 *  like the node). */
const LABEL_GAP = 5;
/** How far the focused node's label moves down, in pixels. */
const FOCUS_LABEL_DROP = 15;

type LabelData = PartialButFor<
  NodeDisplayData,
  "x" | "y" | "size" | "label" | "color"
> & { faded?: boolean; focusLabel?: string };

interface View {
  /** Pixels per graph unit at camera ratio 1. */
  s1: number;
  /** Pixels per graph unit now. */
  scale: number;
  /** Label opacity at this zoom, before fading. */
  textAlpha: number;
  colors: GraphColors;
  display: DisplaySettings;
  /** Faded versions of the colours, by colour (reset with the colours). */
  faded: Map<string, string>;
}

function fadedColor(view: View, color: string): string {
  let out = view.faded.get(color);
  if (out == null) {
    out = fade(color, view.colors.bg, FADED);
    view.faded.set(color, out);
  }
  return out;
}

function drawLabel(view: View) {
  return (ctx: CanvasRenderingContext2D, data: LabelData) => {
    if (!data.label) return;
    const alpha = view.textAlpha * (data.faded ? FADED : 1);
    if (alpha <= 0.001) return;
    const root = Math.sqrt(view.scale);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = view.colors.label;
    ctx.font = `${14 * root + data.size / 4}px ${view.colors.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(data.label, data.x, data.y + data.size + LABEL_GAP * root);
    ctx.restore();
  };
}

/** The focused node: a ring, and its label, always shown and a little lower. */
function drawFocus(view: View) {
  return (ctx: CanvasRenderingContext2D, data: LabelData) => {
    const root = Math.sqrt(view.scale);
    const ring = Math.max(1, root);
    ctx.save();
    ctx.strokeStyle = view.colors.label;
    ctx.lineWidth = ring;
    ctx.beginPath();
    ctx.arc(data.x, data.y, data.size + ring / 2, 0, Math.PI * 2);
    ctx.stroke();
    const label = data.focusLabel ?? data.label;
    if (label) {
      // Readable however far out the view is.
      const px = data.size / root;
      const font = (14 + px / 4) * (view.scale < 1 ? 1 : root);
      ctx.fillStyle = view.colors.label;
      ctx.font = `${font}px ${view.colors.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(
        label,
        data.x,
        data.y + data.size + LABEL_GAP * root + FOCUS_LABEL_DROP,
      );
    }
    ctx.restore();
  };
}

export function GraphCanvas({
  graph,
  colors,
  visibility,
  focus,
  display,
  onHover,
  onClickNode,
  onClickStage,
  onDragStart,
  onDrag,
  onDragEnd,
  onCameraInput,
  ref,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null);
  const [contextLost, setContextLost] = useState(false);
  if (contextLost) throw new Error("WebGL context lost");

  // What the reducers and drawers read. Updated on every render, applied by
  // the effect below; the reducers themselves are installed once.
  const state = useRef({
    graph,
    visibility,
    focus,
    neighbours: new Set<string>(),
  });
  const view = useRef<View>({
    s1: 1,
    scale: 1,
    textAlpha: 1,
    colors,
    display,
    faded: new Map(),
  });
  const handlers = useRef({
    onHover,
    onClickNode,
    onClickStage,
    onDragStart,
    onDrag,
    onDragEnd,
    onCameraInput,
  });
  useEffect(() => {
    handlers.current = {
      onHover,
      onClickNode,
      onClickStage,
      onDragStart,
      onDrag,
      onDragEnd,
      onCameraInput,
    };
  });
  // Set once sigma exists: the smooth zoom toward a ratio.
  const zoomRef = useRef<
    ((ratio: number, anchor?: { x: number; y: number }) => void) | null
  >(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const s = state.current;
    const v = view.current;
    const sigma = new Sigma<NodeAttrs, EdgeAttrs>(s.graph, el, {
      allowInvalidContainer: true,
      defaultNodeType: "file",
      nodeProgramClasses: { file: NodeCircleProgram, tag: NodeCircleProgram },
      stagePadding: 0,
      itemSizesReference: "screen",
      // Node radius on screen = size / this = size · √scale.
      zoomToSizeRatioFunction: (ratio) => Math.sqrt(ratio / v.s1),
      minEdgeThickness: v.display.lineSize,
      labelFont: v.colors.font,
      labelColor: { color: v.colors.label },
      // Every label is a candidate; the drawer fades them by zoom.
      labelDensity: 1e6,
      labelRenderedSizeThreshold: 0,
      defaultDrawNodeLabel: drawLabel(v),
      defaultDrawNodeHover: drawFocus(v),
      hideEdgesOnMove: s.graph.size > HIDE_EDGES_ON_MOVE_ABOVE,
      zIndex: true,
      nodeReducer: (key, data) => {
        const { visibility: vis, focus: f, neighbours } = state.current;
        const { colors: c, display: d } = view.current;
        if (!vis.nodes.has(key)) return { ...data, hidden: true };

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
        const out: Partial<NodeDisplayData> & Record<string, unknown> = {
          ...data,
          size: nodeRadius(vis.degree.get(key) ?? 0, d.nodeSize),
          color: fill,
        };
        if (!f) return out;
        if (key === f) {
          out.color = c.highlight;
          out.highlighted = true;
          out.zIndex = 2;
          // Drawn by drawFocus instead, lower down.
          out.focusLabel = data.label;
          out.label = null;
        } else if (neighbours.has(key)) {
          out.zIndex = 1;
        } else {
          out.color = fadedColor(view.current, fill);
          out.faded = true;
          out.zIndex = 0;
        }
        return out;
      },
      edgeReducer: (key, data) => {
        const { graph: g, visibility: vis, focus: f } = state.current;
        const { colors: c } = view.current;
        if (!vis.edges.has(key)) return { ...data, hidden: true };
        // Width comes from minEdgeThickness: a constant number of pixels.
        const out: Partial<EdgeDisplayData> & EdgeAttrs = {
          ...data,
          size: 0.001,
          color: c.edge,
        };
        if (!f) return out;
        if (g.source(key) === f || g.target(key) === f) {
          out.color = c.highlight;
          out.zIndex = 1;
        } else {
          out.color = fadedColor(view.current, c.edge);
        }
        return out;
      },
    });
    sigmaRef.current = sigma;

    const camera = sigma.getCamera();
    // The frame never follows the graph; a resize keeps the scale.
    let sized = false;
    function reframe() {
      const { width, height } = sigma.getDimensions();
      // sigma maps the square frame onto the viewport's smaller side (no
      // stage padding, no aspect correction for a square).
      const s1 = Math.min(width, height) / (FRAME.x[1] - FRAME.x[0]);
      if (!sigma.getCustomBBox()) sigma.setCustomBBox(FRAME);
      sigma.refresh();
      // Until the container has a size there is no scale to keep.
      if (sized && s1 !== v.s1)
        camera.setState({ ratio: camera.ratio * (s1 / v.s1) });
      sized = width > 1 && height > 1;
      v.s1 = s1;
      sigma.setSetting("minCameraRatio", s1 / MAX_SCALE);
      sigma.setSetting("maxCameraRatio", s1 / MIN_SCALE);
    }
    reframe();

    sigma.on("beforeRender", () => {
      v.scale = v.s1 / camera.ratio;
      v.textAlpha = Math.min(
        1,
        Math.max(0, Math.log2(v.scale) + 1 - v.display.textFade),
      );
    });

    // Smooth zoom, anchored at a viewport point (the pointer for the wheel).
    let zoomTarget = camera.ratio;
    let zoomAnchor = { x: 0, y: 0 };
    let zoomFrame = 0;
    function stepZoom() {
      zoomFrame = 0;
      const current = camera.ratio;
      let next = zoomTarget + (current - zoomTarget) * ZOOM_EASE;
      if (Math.abs(next / zoomTarget - 1) < 0.002) next = zoomTarget;
      camera.setState(sigma.getViewportZoomedState(zoomAnchor, next));
      if (next !== zoomTarget) zoomFrame = requestAnimationFrame(stepZoom);
    }
    function zoomTo(ratio: number, anchor?: { x: number; y: number }) {
      const { width, height } = sigma.getDimensions();
      zoomTarget = Math.min(
        v.s1 / MIN_SCALE,
        Math.max(v.s1 / MAX_SCALE, ratio),
      );
      zoomAnchor = anchor ?? { x: width / 2, y: height / 2 };
      if (!zoomFrame) zoomFrame = requestAnimationFrame(stepZoom);
    }
    zoomRef.current = zoomTo;
    const captor = sigma.getMouseCaptor();
    captor.on("mousedown", () => handlers.current.onCameraInput?.());
    captor.on("wheel", (e) => {
      e.preventSigmaDefault();
      handlers.current.onCameraInput?.();
      const base = zoomFrame ? zoomTarget : camera.ratio;
      // sigma's delta is -deltaY / 120: one notch of a mouse wheel.
      zoomTo(base / Math.pow(WHEEL_STEP, e.delta), { x: e.x, y: e.y });
    });

    // The right-button pan in progress (see below): where it last was.
    let panFrom: { x: number; y: number } | null = null;
    // While the right button pans, the cursor stays a grabbing hand.
    let hoveredNode: string | null = null;
    sigma.on("enterNode", ({ node }) => {
      hoveredNode = node;
      if (!panFrom) el.style.cursor = "pointer";
      handlers.current.onHover(node);
    });
    sigma.on("leaveNode", () => {
      hoveredNode = null;
      if (!panFrom) el.style.cursor = "";
      handlers.current.onHover(null);
    });
    // Dragging a node. A press alone is not a drag (a click opens): the drag
    // starts once the pointer has moved a few pixels with the left button down.
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
        if (handlers.current.onDragStart(pressed.node)) dragged = pressed.node;
        else pressed = null;
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
    // (The right button's release is the right-button pan's, below.)
    const endDragOnUp = (e: MouseEvent) => {
      if (e.button === 0) endDrag();
    };
    window.addEventListener("mouseup", endDragOnUp);
    window.addEventListener("blur", endDrag);

    // Panning with the right button held down, over nodes too (sigma pans
    // with the left button only, which on a node drags it instead).
    const box: HTMLDivElement = el;
    const viewportPoint = (e: MouseEvent) => {
      const r = box.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    function onPanStart(e: MouseEvent) {
      // The right button alone: with the left one down too, sigma's pan or a
      // node drag is already under way.
      if (e.button !== 2 || e.buttons !== 2) return;
      e.preventDefault();
      // Stop an easing (sigma's pan inertia, a double-click zoom) that would
      // otherwise pull the camera back from under the pointer.
      if (camera.isAnimated())
        void camera.animate(camera.getState(), { duration: 1 });
      panFrom = viewportPoint(e);
      box.style.cursor = "grabbing";
    }
    function onPanMove(e: MouseEvent) {
      if (!panFrom) return;
      // Released unseen, or the left button joined in.
      if (e.buttons !== 2) {
        onPanEnd();
        return;
      }
      const to = viewportPoint(e);
      const a = sigma.viewportToFramedGraph(panFrom);
      const b = sigma.viewportToFramedGraph(to);
      const { x, y } = camera.getState();
      camera.setState({ x: x + a.x - b.x, y: y + a.y - b.y });
      panFrom = to;
    }
    function onPanEnd(e?: MouseEvent) {
      if (!panFrom || (e && e.button !== 2)) return;
      panFrom = null;
      box.style.cursor = hoveredNode ? "pointer" : "";
    }
    // The graph has no context menu of its own; the button pans instead.
    const noMenu = (e: Event) => e.preventDefault();
    box.addEventListener("mousedown", onPanStart);
    box.addEventListener("contextmenu", noMenu);
    window.addEventListener("mousemove", onPanMove);
    window.addEventListener("mouseup", onPanEnd);
    const onBlur = () => onPanEnd();
    window.addEventListener("blur", onBlur);

    sigma.on("clickNode", ({ node, event }) => {
      if (justDragged) {
        justDragged = false;
        return;
      }
      if (event.original instanceof MouseEvent && event.original.button !== 0)
        return;
      handlers.current.onClickNode(node);
    });
    // The first click already opened the node.
    sigma.on("doubleClickNode", (e) => e.preventSigmaDefault());
    sigma.on("clickStage", () => {
      if (justDragged) {
        justDragged = false;
        return;
      }
      handlers.current.onClickStage();
    });

    const canvas = el.querySelector("canvas");
    const onLost = () => setContextLost(true);
    canvas?.addEventListener("webglcontextlost", onLost);
    const resize = new ResizeObserver(() => {
      sigma.resize();
      reframe();
    });
    resize.observe(el);
    return () => {
      if (zoomFrame) cancelAnimationFrame(zoomFrame);
      zoomRef.current = null;
      window.removeEventListener("mouseup", endDragOnUp);
      window.removeEventListener("blur", endDrag);
      box.removeEventListener("mousedown", onPanStart);
      box.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("mousemove", onPanMove);
      window.removeEventListener("mouseup", onPanEnd);
      window.removeEventListener("blur", onBlur);
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
    const v = view.current;
    const neighbours = new Set<string>();
    if (focus && graph.hasNode(focus)) {
      graph.forEachEdge(focus, (edge, _attrs, a, b) => {
        if (visibility.edges.has(edge)) neighbours.add(a === focus ? b : a);
      });
    }
    state.current = { graph, visibility, focus, neighbours };
    const colorsChanged = v.colors !== colors;
    v.colors = colors;
    if (colorsChanged) v.faded = new Map();
    v.display = display;
    if (!sigma) return;
    if (colorsChanged) sigma.setSetting("labelFont", colors.font);
    if (sigma.getSetting("minEdgeThickness") !== display.lineSize)
      sigma.setSetting("minEdgeThickness", display.lineSize);
    const hideEdges = graph.size > HIDE_EDGES_ON_MOVE_ABOVE;
    if (sigma.getSetting("hideEdgesOnMove") !== hideEdges)
      sigma.setSetting("hideEdgesOnMove", hideEdges);
    // setGraph refreshes by itself. Otherwise the refresh waits for the next
    // frame, so a sweep of hovers (or a slider) costs one per frame, shared
    // with the simulation's.
    if (sigma.getGraph() !== graph) sigma.setGraph(graph);
    else sigma.scheduleRefresh();
  }, [graph, colors, visibility, focus, display]);

  useImperativeHandle(ref, () => {
    /** The camera that frames the visible nodes, from their graph positions
     *  (sigma's own copy may be a frame behind). */
    const fitState = (): Partial<CameraState> | null => {
      const sigma = sigmaRef.current;
      if (!sigma) return null;
      const { graph: g, visibility: vis } = state.current;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const key of vis.nodes) {
        if (!g.hasNode(key)) continue;
        const { x, y } = g.getNodeAttributes(key);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      if (x0 > x1) return null;
      const framed = (x: number, y: number) =>
        sigma.viewportToFramedGraph(sigma.graphToViewport({ x, y }));
      const a = framed(x0, y0);
      const b = framed(x1, y1);
      // At ratio r a framed unit is min(width, height) / r pixels.
      const { width, height } = sigma.getDimensions();
      const side = Math.min(width, height);
      const need = Math.max(
        (Math.abs(b.x - a.x) * side) / width,
        (Math.abs(b.y - a.y) * side) / height,
      );
      const s1 = view.current.s1;
      // Room for the nodes' own radius and labels at the edges.
      const ratio = need > 0 ? need * 1.15 : s1;
      return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        ratio: Math.min(s1 / MIN_SCALE, Math.max(s1 / MAX_SCALE, ratio)),
      };
    };
    return {
      fit: (animate = true) => {
        const sigma = sigmaRef.current;
        const target = fitState();
        if (!sigma || !target) return;
        const camera = sigma.getCamera();
        if (animate) void camera.animate(target, { duration: ANIMATION_MS });
        else camera.setState(target);
      },
      zoomIn: () => {
        handlers.current.onCameraInput?.();
        const camera = sigmaRef.current?.getCamera();
        if (camera) zoomRef.current?.(camera.ratio / WHEEL_STEP);
      },
      zoomOut: () => {
        handlers.current.onCameraInput?.();
        const camera = sigmaRef.current?.getCamera();
        if (camera) zoomRef.current?.(camera.ratio * WHEEL_STEP);
      },
      focus: (key) => {
        const sigma = sigmaRef.current;
        const g = state.current.graph;
        if (!sigma || !g.hasNode(key)) return;
        const { x, y } = g.getNodeAttributes(key);
        const p = sigma.viewportToFramedGraph(sigma.graphToViewport({ x, y }));
        const camera = sigma.getCamera();
        void camera.animate(
          // At scale 1 or closer, where labels are fully shown.
          { x: p.x, y: p.y, ratio: Math.min(camera.ratio, view.current.s1) },
          { duration: ANIMATION_MS * 2 },
        );
      },
    };
  }, []);

  return (
    <div
      ref={container}
      className="absolute inset-0"
      data-slot="graph-canvas"
    />
  );
}
