// The 3D surface of the graph view (three.js), taking the same props and
// handle as the flat GraphCanvas so the view can swap one for the other.
// The look follows the flat view: node radius clamp(3·√(weight + 1), 8, 30)
// graph units, the same colours, faded and highlight rules, and labels under
// their node that fade in as the node's scale (pixels per graph unit at its
// depth) grows. Fog towards the background colour gives depth.
//
// Nodes are one instanced sphere mesh and links one set of line segments, so
// thousands of each cost two draw calls. Picking and labels work in screen
// space: every visible node is projected once per rendered frame.
//
// Mouse: left drags a node, or orbits from the background; right pans; the
// wheel zooms toward the pointer; a click without movement opens a node.
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Fog,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshLambertMaterial,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GraphCanvasHandle, GraphCanvasProps } from "./canvasTypes";
import {
  FADED,
  FOCUS_LABEL_DROP,
  LABEL_GAP,
  fade,
  focusLabelFontPx,
  labelFontPx,
  nodeFill,
  nodeRadius,
  nodeWeights,
  textAlpha,
} from "./model/appearance";
import type { MediaGraph, NodeAttrs } from "./model/types";
import {
  boundingSphere,
  fitDistance,
  labelInView,
  pixelsPerUnit,
} from "./model/view3d";
import type { GraphColors } from "./useGraphColors";

const FOV = 50;
/** Pointer travel (px) that turns a press into a drag, as in the flat view. */
const DRAG_START_PX = 5;
/** Most labels drawn in a frame (the nearest on-screen ones win). */
const MAX_LABELS = 400;
/** Buttons and the wheel zoom by this factor, as in the flat view. */
const ZOOM_STEP = 1.5;
const ANIMATION_MS = 300;
const FOCUS_DISTANCE = 600;

type Props = GraphCanvasProps & { ref?: Ref<GraphCanvasHandle> };

export function GraphCanvas3D({
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
  const [contextLost, setContextLost] = useState(false);
  if (contextLost) throw new Error("WebGL context lost");

  // What the frame loop reads; brought up to date after every render.
  const state = useRef({ graph, colors, visibility, focus, display });
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
    state.current = { graph, colors, visibility, focus, display };
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
  // Set by the scene effect: the handle's implementation.
  const api = useRef<GraphCanvasHandle | null>(null);
  // What changed since the last frame: the frame loop only redoes that, and
  // draws nothing at all when nothing changed.
  const changed = useRef({
    structure: true,
    sizes: true,
    colors: true,
    overlay: true,
  });

  useEffect(() => {
    changed.current.structure = true;
  }, [graph, visibility]);
  useEffect(() => {
    changed.current.sizes = true;
    changed.current.overlay = true;
  }, [display]);
  useEffect(() => {
    changed.current.colors = true;
  }, [colors, focus]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const box: HTMLDivElement = el;

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    // setSize below leaves the CSS size alone (the buffer is at device pixels).
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    box.appendChild(renderer.domElement);
    // Labels and the focus ring, drawn in 2D over the WebGL canvas.
    const overlay = document.createElement("canvas");
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.pointerEvents = "none";
    box.appendChild(overlay);
    const ctx = overlay.getContext("2d");
    const onLost = () => setContextLost(true);
    renderer.domElement.addEventListener("webglcontextlost", onLost);

    const scene = new Scene();
    const camera = new PerspectiveCamera(FOV, 1, 1, 1e7);
    camera.position.set(0, 0, 3000);
    scene.add(camera);
    scene.add(new AmbientLight(0xffffff, 1.6));
    // The light rides with the camera, so the side facing the viewer is lit.
    const light = new DirectionalLight(0xffffff, 1.4);
    light.position.set(0.4, 0.6, 1);
    camera.add(light);
    const fog = new Fog(0x000000, 1, 2);
    scene.fog = fog;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.zoomToCursor = true;
    controls.zoomSpeed = 1.2;
    controls.minDistance = 10;
    controls.maxDistance = 1e6;
    controls.addEventListener("start", () => {
      framed = true;
      // The user takes over from a fit or focus still easing in.
      tween = null;
      handlers.current.onCameraInput?.();
    });

    const sphere = new SphereGeometry(1, 12, 8);
    const nodeMaterial = new MeshLambertMaterial();
    // Translucent: thousands of crossing links would otherwise wall off the
    // nodes behind them, which the flat view never has to contend with.
    const lineMaterial = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    let mesh: InstancedMesh | null = null;
    let lines: LineSegments | null = null;

    // --- the scene's contents, rebuilt when the graph or what shows changes ---
    let keys: string[] = [];
    let indexOf = new Map<string, number>();
    let shown: boolean[] = [];
    let weights = new Map<string, number>();
    let edgeEnds: [number, number][] = [];
    let edgeKeys: string[] = [];
    let boundGraph: MediaGraph | null = null;
    let positionsDirty = true;
    // Something outside the change flags asks for a frame (pointer, resize).
    let frameWanted = true;
    const markPositions = () => {
      positionsDirty = true;
    };

    function rebuild() {
      const { graph: g, visibility: vis, display: d } = state.current;
      if (boundGraph !== g) {
        boundGraph?.off("eachNodeAttributesUpdated", markPositions);
        boundGraph?.off("nodeAttributesUpdated", markPositions);
        g.on("eachNodeAttributesUpdated", markPositions);
        g.on("nodeAttributesUpdated", markPositions);
        boundGraph = g;
      }
      keys = g.nodes();
      shown = keys.map((k) => vis.nodes.has(k));
      weights = nodeWeights(g, vis, d.sizeBy);
      indexOf = new Map(keys.map((k, i) => [k, i]));
      edgeKeys = [...vis.edges];
      edgeEnds = edgeKeys.map((e) => {
        const [a, b] = g.extremities(e);
        return [indexOf.get(a) ?? 0, indexOf.get(b) ?? 0];
      });
      if (mesh) {
        scene.remove(mesh);
        mesh.dispose();
      }
      mesh = new InstancedMesh(sphere, nodeMaterial, Math.max(1, keys.length));
      mesh.count = keys.length;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
      if (lines) {
        scene.remove(lines);
        lines.geometry.dispose();
      }
      const geometry = new BufferGeometry();
      const pos = new BufferAttribute(new Float32Array(edgeEnds.length * 6), 3);
      pos.setUsage(DynamicDrawUsage);
      geometry.setAttribute("position", pos);
      geometry.setAttribute(
        "color",
        new BufferAttribute(new Float32Array(edgeEnds.length * 6), 3),
      );
      lines = new LineSegments(geometry, lineMaterial);
      lines.frustumCulled = false;
      scene.add(lines);
      positionsDirty = true;
      changed.current.colors = true;
    }

    // Read fresh each time: the view may replace a node's attributes object.
    const at = (i: number): NodeAttrs =>
      (boundGraph as MediaGraph).getNodeAttributes(keys[i]);
    const matrix = new Matrix4();
    const radii: number[] = [];
    // Nodes are drawn at √scale as in the flat view (scale: pixels per graph
    // unit at the orbit target), so they shrink slower than the graph when
    // the camera backs off instead of vanishing into dots.
    let sizeFactor = 1;
    function placeAll() {
      if (!mesh || !lines) return;
      const { display: d } = state.current;
      for (let i = 0; i < keys.length; i++) {
        const a = at(i);
        const r = shown[i]
          ? nodeRadius(weights.get(keys[i]) ?? 0, d.nodeSize) * sizeFactor
          : 0;
        radii[i] = r;
        matrix.makeScale(r || 1e-9, r || 1e-9, r || 1e-9);
        matrix.setPosition(a.x, a.y, a.z);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      const pos = lines.geometry.getAttribute("position") as BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let k = 0; k < edgeEnds.length; k++) {
        const p = at(edgeEnds[k][0]);
        const q = at(edgeEnds[k][1]);
        const o = k * 6;
        arr[o] = p.x;
        arr[o + 1] = p.y;
        arr[o + 2] = p.z;
        arr[o + 3] = q.x;
        arr[o + 4] = q.y;
        arr[o + 5] = q.z;
      }
      pos.needsUpdate = true;
    }

    // Parsed once per colour string: there are only a handful.
    const parsed = new Map<string, Color>();
    const rgb = (color: string): Color => {
      let out = parsed.get(color);
      if (!out) {
        out = new Color(color);
        parsed.set(color, out);
      }
      return out;
    };
    const faded = new Map<string, string>();
    let fadedFor: GraphColors | null = null;
    function fadedColor(c: GraphColors, color: string): string {
      if (fadedFor !== c) {
        faded.clear();
        fadedFor = c;
      }
      let out = faded.get(color);
      if (out == null) {
        out = fade(color, c.bg, FADED);
        faded.set(color, out);
      }
      return out;
    }
    let neighbours = new Set<string>();
    function recolour() {
      if (!mesh || !lines) return;
      const { colors: c, focus: f, graph: g, visibility: vis } = state.current;
      neighbours = new Set();
      if (f && g.hasNode(f))
        g.forEachEdge(f, (e, _a, s, t) => {
          if (vis.edges.has(e)) neighbours.add(s === f ? t : s);
        });
      renderer.setClearColor(c.bg);
      fog.color.set(c.bg);
      keys.forEach((k, i) => {
        const fill = nodeFill(at(i), c);
        const color = !f
          ? fill
          : k === f
            ? c.highlight
            : neighbours.has(k)
              ? fill
              : fadedColor(c, fill);
        mesh?.setColorAt(i, rgb(color));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const col = lines.geometry.getAttribute("color") as BufferAttribute;
      const arr = col.array as Float32Array;
      edgeEnds.forEach(([a, b], k) => {
        const lit = f && (keys[a] === f || keys[b] === f);
        const col = rgb(
          !f ? c.edge : lit ? c.highlight : fadedColor(c, c.edge),
        );
        arr[k * 6] = arr[k * 6 + 3] = col.r;
        arr[k * 6 + 1] = arr[k * 6 + 4] = col.g;
        arr[k * 6 + 2] = arr[k * 6 + 5] = col.b;
      });
      col.needsUpdate = true;
    }

    // --- screen space: projections for picking and labels ------------------
    let width = 1;
    let height = 1;
    const sx: number[] = [];
    const sy: number[] = [];
    const sd: number[] = [];
    const spx: number[] = [];
    // Reused across frames by the label pass.
    const order: number[] = [];
    let alphas = new Float32Array(0);
    const v = new Vector3();
    function project() {
      for (let i = 0; i < keys.length; i++) {
        if (!shown[i]) {
          sd[i] = -1;
          continue;
        }
        const a = at(i);
        // Perspective scales with the depth along the view axis, not the
        // distance to the eye, which grows off-axis. project() in two steps,
        // keeping that depth from the camera-space point.
        v.set(a.x, a.y, a.z).applyMatrix4(camera.matrixWorldInverse);
        const depth = -v.z;
        v.applyMatrix4(camera.projectionMatrix);
        if (v.z > 1 || v.z < -1) {
          sd[i] = -1;
          continue;
        }
        sx[i] = ((v.x + 1) / 2) * width;
        sy[i] = ((1 - v.y) / 2) * height;
        sd[i] = depth;
        spx[i] = radii[i] * pixelsPerUnit(depth, FOV, height);
      }
    }

    /** The visible node under a viewport point, nearest to the camera. */
    function pick(px: number, py: number): number {
      let best = -1;
      let bestDepth = Infinity;
      for (let i = 0; i < keys.length; i++) {
        if (sd[i] < 0) continue;
        const r = Math.max(spx[i], 3);
        const dx = px - sx[i];
        const dy = py - sy[i];
        if (dx * dx + dy * dy <= r * r && sd[i] < bestDepth) {
          best = i;
          bestDepth = sd[i];
        }
      }
      return best;
    }

    function drawOverlay() {
      if (!ctx) return;
      const { colors: c, focus: f, display: d } = state.current;
      const dpr = window.devicePixelRatio;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      // Candidates are the labels that would show: nearer nodes off to the
      // side must not take the places, and a shorter list is quicker to
      // sort, which happens every frame.
      order.length = 0;
      if (alphas.length < keys.length) alphas = new Float32Array(keys.length);
      for (let i = 0; i < keys.length; i++) {
        if (sd[i] < 0 || keys[i] === f) continue;
        const scale = pixelsPerUnit(sd[i], FOV, height);
        const faded = !!f && !neighbours.has(keys[i]);
        const alpha = textAlpha(scale, d.textFade) * (faded ? FADED : 1);
        if (alpha <= 0.001) continue;
        // A character is taken as a full em wide, so a label is never
        // judged narrower than it is.
        const fontPx = labelFontPx(scale, spx[i]);
        const half = (at(i).label.length * fontPx) / 2;
        const below = LABEL_GAP * Math.sqrt(scale) + fontPx;
        if (!labelInView(sx[i], sy[i], spx[i], half, below, width, height))
          continue;
        alphas[i] = alpha;
        order.push(i);
      }
      order.sort((a, b) => sd[a] - sd[b]);
      const drawn = order.slice(0, MAX_LABELS).reverse();
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = c.label;
      for (const i of drawn) {
        const scale = pixelsPerUnit(sd[i], FOV, height);
        const alpha = alphas[i];
        const root = Math.sqrt(scale);
        ctx.globalAlpha = alpha;
        // Rounded, so the canvas can reuse a parsed font across labels.
        const font = `${Math.round(labelFontPx(scale, spx[i]) * 2) / 2}px ${c.font}`;
        if (ctx.font !== font) ctx.font = font;
        ctx.fillText(at(i).label, sx[i], sy[i] + spx[i] + LABEL_GAP * root);
      }
      ctx.globalAlpha = 1;
      const fi = f ? (indexOf.get(f) ?? -1) : -1;
      if (fi >= 0 && sd[fi] >= 0) {
        // The focused node: a ring, and its label always, a little lower.
        const scale = pixelsPerUnit(sd[fi], FOV, height);
        const root = Math.sqrt(scale);
        const ring = Math.max(1, root);
        ctx.strokeStyle = c.label;
        ctx.lineWidth = ring;
        ctx.beginPath();
        ctx.arc(sx[fi], sy[fi], spx[fi] + ring / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = `${focusLabelFontPx(scale, spx[fi])}px ${c.font}`;
        ctx.fillText(
          at(fi).label,
          sx[fi],
          sy[fi] + spx[fi] + LABEL_GAP * root + FOCUS_LABEL_DROP,
        );
      }
    }

    // --- camera moves ---------------------------------------------------------
    // The scene may load after the view first asked for a fit (three.js is
    // fetched on demand): until some fit ran, the first frame with nodes fits.
    let framed = false;
    let tween: {
      from: Vector3;
      fromTarget: Vector3;
      to: Vector3;
      toTarget: Vector3;
      start: number;
      ms: number;
    } | null = null;
    function moveCamera(to: Vector3, target: Vector3, ms: number) {
      if (ms <= 0) {
        camera.position.copy(to);
        controls.target.copy(target);
        controls.update();
        tween = null;
        return;
      }
      tween = {
        from: camera.position.clone(),
        fromTarget: controls.target.clone(),
        to,
        toTarget: target,
        start: performance.now(),
        ms,
      };
    }
    function dolly(factor: number) {
      handlers.current.onCameraInput?.();
      const offset = camera.position.clone().sub(controls.target);
      const to = controls.target.clone().add(offset.multiplyScalar(factor));
      moveCamera(to, controls.target.clone(), ANIMATION_MS);
    }
    api.current = {
      fit: (animate = true) => {
        framed = true;
        const { graph: g, visibility: vis } = state.current;
        const pts: number[] = [];
        for (const key of vis.nodes) {
          if (!g.hasNode(key)) continue;
          const a = g.getNodeAttributes(key);
          pts.push(a.x, a.y, a.z);
        }
        const sphere = boundingSphere(pts);
        if (!sphere) return;
        const target = new Vector3(...sphere.center);
        const dir = camera.position.clone().sub(controls.target);
        if (dir.lengthSq() === 0) dir.set(0, 0, 1);
        dir.normalize();
        const dist = fitDistance(sphere.radius + 30, FOV, width / height);
        moveCamera(
          target.clone().add(dir.multiplyScalar(dist)),
          target,
          animate ? ANIMATION_MS : 0,
        );
      },
      zoomIn: () => dolly(1 / ZOOM_STEP),
      zoomOut: () => dolly(ZOOM_STEP),
      focus: (key) => {
        const g = state.current.graph;
        if (!g.hasNode(key)) return;
        const a = g.getNodeAttributes(key);
        const target = new Vector3(a.x, a.y, a.z);
        const dir = camera.position.clone().sub(controls.target);
        if (dir.lengthSq() === 0) dir.set(0, 0, 1);
        const dist = Math.min(dir.length(), FOCUS_DISTANCE);
        moveCamera(
          target.clone().add(dir.normalize().multiplyScalar(dist)),
          target,
          ANIMATION_MS * 2,
        );
      },
    };

    // --- pointer: hover, click, node drag ------------------------------------
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const plane = new Plane();
    const hit = new Vector3();
    // Held by key: a refetch mid-press rebuilds the arrays and moves indices.
    let pressed: { key: string; x: number; y: number } | null = null;
    let stagePress: { x: number; y: number } | null = null;
    let dragged: string | null = null;
    let hovered: string | null = null;
    let pointer: { x: number; y: number } | null = null;
    const local = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    function setHover(i: number) {
      const key = i >= 0 ? keys[i] : null;
      if (key === hovered) return;
      hovered = key;
      box.style.cursor = key ? "pointer" : "";
      handlers.current.onHover(key);
    }
    // Capture phase: runs before OrbitControls, which a press on a node
    // must not reach (it would orbit instead of dragging the node).
    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      const p = local(e);
      const i = pick(p.x, p.y);
      if (i >= 0) {
        pressed = { key: keys[i], ...p };
        controls.enabled = false;
        box.setPointerCapture(e.pointerId);
      } else {
        stagePress = p;
      }
    }
    function onMove(e: PointerEvent) {
      const p = local(e);
      pointer = p;
      frameWanted = true;
      if (pressed && dragged == null) {
        if (Math.hypot(p.x - pressed.x, p.y - pressed.y) < DRAG_START_PX)
          return;
        const key = pressed.key;
        const g = state.current.graph;
        if (g.hasNode(key) && handlers.current.onDragStart(key)) {
          dragged = key;
          // Dragged across the plane facing the camera through the node.
          const a = g.getNodeAttributes(key);
          const normal = camera.getWorldDirection(new Vector3());
          plane.setFromNormalAndCoplanarPoint(
            normal,
            new Vector3(a.x, a.y, a.z),
          );
        } else {
          pressed = null;
          controls.enabled = true;
        }
      }
      if (dragged == null) return;
      const key = dragged;
      const g = state.current.graph;
      if (!g.hasNode(key)) {
        endDrag();
        return;
      }
      ndc.set((p.x / width) * 2 - 1, -(p.y / height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      g.mergeNodeAttributes(key, { x: hit.x, y: hit.y, z: hit.z });
      handlers.current.onDrag(key, hit.x, hit.y, hit.z);
    }
    function endDrag() {
      if (dragged != null) {
        const key = dragged;
        dragged = null;
        handlers.current.onDragEnd(key);
      }
      stagePress = null;
      pressed = null;
      controls.enabled = true;
    }
    function onUp(e: PointerEvent) {
      if (e.button !== 0) return;
      const p = local(e);
      if (pressed && dragged == null) {
        const key = pressed.key;
        pressed = null;
        controls.enabled = true;
        handlers.current.onClickNode(key);
      } else if (dragged != null) {
        endDrag();
      } else if (
        stagePress &&
        Math.hypot(p.x - stagePress.x, p.y - stagePress.y) < DRAG_START_PX
      ) {
        handlers.current.onClickStage();
      }
      stagePress = null;
    }
    function onLeave() {
      pointer = null;
      setHover(-1);
    }
    box.addEventListener("pointerdown", onDown, { capture: true });
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerup", onUp);
    box.addEventListener("pointerleave", onLeave);
    // A press the system took away (a gesture, a lost capture) ends like a
    // release would, so the controls and the simulation are not left held.
    box.addEventListener("pointercancel", endDrag);
    box.addEventListener("lostpointercapture", endDrag);
    window.addEventListener("blur", endDrag);

    // --- sizing -----------------------------------------------------------------
    function resize() {
      width = Math.max(1, box.clientWidth);
      height = Math.max(1, box.clientHeight);
      renderer.setSize(width, height, false);
      const dpr = window.devicePixelRatio;
      overlay.width = Math.round(width * dpr);
      overlay.height = Math.round(height * dpr);
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      frameWanted = true;
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(box);

    // --- the frame loop ----------------------------------------------------------
    let frame = 0;
    function loop(now: number) {
      frame = requestAnimationFrame(loop);
      if (tween) {
        const t = Math.min(1, (now - tween.start) / tween.ms);
        const ease = 1 - (1 - t) * (1 - t);
        camera.position.lerpVectors(tween.from, tween.to, ease);
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, ease);
        if (t >= 1) tween = null;
      }
      // Damping keeps it moving for a while after the pointer lets go.
      const moved = controls.update();
      const dist = camera.position.distanceTo(controls.target);
      const factor = 1 / Math.sqrt(pixelsPerUnit(dist, FOV, height));
      if (Math.abs(factor / sizeFactor - 1) > 0.01) {
        sizeFactor = factor;
        positionsDirty = true;
      }
      const c = changed.current;
      let draw = moved || tween != null || frameWanted || c.overlay;
      frameWanted = false;
      c.overlay = false;
      if (c.structure) {
        c.structure = false;
        rebuild();
        draw = true;
        if (!framed && shown.some(Boolean)) api.current?.fit(false);
      }
      if (c.sizes) {
        c.sizes = false;
        weights = nodeWeights(
          state.current.graph,
          state.current.visibility,
          state.current.display.sizeBy,
        );
        positionsDirty = true;
      }
      if (positionsDirty) {
        positionsDirty = false;
        placeAll();
        draw = true;
      }
      if (c.colors) {
        c.colors = false;
        recolour();
        draw = true;
      }
      // Nothing moved or changed: the last frame still stands.
      if (!draw) return;
      // Fog from just in front of the graph to well behind it.
      fog.near = dist * 0.8;
      fog.far = dist * 2.6;
      renderer.render(scene, camera);
      project();
      if (pointer && !pressed && dragged == null)
        setHover(pick(pointer.x, pointer.y));
      drawOverlay();
    }
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      api.current = null;
      observer.disconnect();
      box.removeEventListener("pointerdown", onDown, { capture: true });
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerup", onUp);
      box.removeEventListener("pointerleave", onLeave);
      box.removeEventListener("pointercancel", endDrag);
      box.removeEventListener("lostpointercapture", endDrag);
      window.removeEventListener("blur", endDrag);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      boundGraph?.off("eachNodeAttributesUpdated", markPositions);
      boundGraph?.off("nodeAttributesUpdated", markPositions);
      controls.dispose();
      mesh?.dispose();
      lines?.geometry.dispose();
      sphere.dispose();
      nodeMaterial.dispose();
      lineMaterial.dispose();
      renderer.dispose();
      box.removeChild(renderer.domElement);
      box.removeChild(overlay);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      fit: (animate) => api.current?.fit(animate),
      zoomIn: () => api.current?.zoomIn(),
      zoomOut: () => api.current?.zoomOut(),
      focus: (key) => api.current?.focus(key),
    }),
    [],
  );

  return (
    <div
      ref={container}
      className="absolute inset-0"
      data-slot="graph-canvas-3d"
    />
  );
}
