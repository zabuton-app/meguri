// The graph view mode: the current list's files and their tags as a network,
// simulated and drawn the way Obsidian's graph view is. Each payload builds a
// new graphology graph that takes over the positions of the one before, so a
// refetch keeps the picture and the camera (one sigma for the component,
// keyed by scope in Home). What is visible is what the force simulation (a
// worker, see sim/) moves: a change of data or filters reloads it with the
// visible nodes, seating any that have no position yet.
// Positions come from what is on screen, where a node last stood, the
// scope's layout cache, or placement.ts.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { Maximize, Minus, Plus, Share2 } from "lucide-react";
import { tagSearchToken, qualifiedTagName } from "@shared/tags";
import { GRAPH_NODE_KEY_MAX } from "@shared/ipc/graph";
import { api } from "@/ipc/client";
import type { SearchQuery } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { fileHref } from "@/lib/fileHref";
import log from "@/lib/logger";
import { buildGraphology, emptyGraph } from "./model/buildGraphology";
import { placeNodes, type Point } from "./model/placement";
import type { MediaGraph } from "./model/types";
import { visibleSet } from "./model/visibility";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import { GraphErrorBoundary } from "./GraphErrorBoundary";
import { GraphLegend } from "./GraphLegend";
import { GraphSearch } from "./GraphSearch";
import { GraphSettingsPanel } from "./GraphSettingsPanel";
import { GraphToolbar } from "./GraphToolbar";
import { useGraphOptions } from "./graphOptions";
import { physicsOf, useGraphSettings } from "./graphSettings";
import { REHEAT_ALPHA } from "./sim/physics";
import { SimClient } from "./sim/simClient";
import { useGraphColors } from "./useGraphColors";
import { useGraphData } from "./useGraphData";

/** Positions are written this long after the simulation last cooled down. */
const SAVE_DEBOUNCE_MS = 2_000;

interface Props {
  /** Active target: workspace id, "__all__" or "collection:<id>". */
  scope: string;
  query: SearchQuery;
  ready: boolean;
  /** Keyboard shortcuts apply (the list is in front, no overlay). */
  keysActive: boolean;
  /** Add a search token to the list's filter (a clicked tag). */
  onFilterToken: (token: string) => void;
}

/** What the simulation was last loaded with. */
interface Simulated {
  gen: number;
  graph: MediaGraph;
  /** Node key → its index in the simulation. */
  index: Map<string, number>;
  keys: string[];
  links: Uint32Array;
  epoch: number;
}

function sameArray<T>(a: ArrayLike<T>, b: ArrayLike<T>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

function CameraButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-11 items-center justify-center text-secondary-fg transition hover:bg-fg/10 hover:text-fg"
    >
      {children}
    </button>
  );
}

export function GraphView({
  scope,
  query,
  ready,
  keysActive,
  onFilterToken,
}: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const colors = useGraphColors();
  const [graph, setGraph] = useState<MediaGraph>(emptyGraph);
  // The graph callbacks and the unmount save act on: always the latest.
  const graphRef = useRef(graph);
  // Nodes with a real position (the rest sit at a placeholder until shown).
  const seated = useRef(new Set<string>());
  // Where nodes that a filter took out of the data last stood, so they come
  // back there rather than at the (older) cached spot.
  const lastSeen = useRef(new Map<string, Point>());
  // The node under the pointer in a drag: its position comes from the
  // pointer, so the worker's (a frame behind) is not applied to it.
  const holding = useRef<string | null>(null);
  // After a re-layout the cache describes the old picture.
  const cacheStale = useRef(false);
  const simulated = useRef<Simulated>({
    gen: 0,
    graph,
    index: new Map(),
    keys: [],
    links: new Uint32Array(0),
    epoch: 0,
  });
  // The camera frames the graph when it first has nodes, and again once the
  // first layout has settled (a fresh one spreads out), unless the user has
  // moved the camera by then.
  const framed = useRef(false);
  const refit = useRef(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // A node picked in the graph search, highlighted until dismissed.
  const [selected, setSelected] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Bumped by "Re-layout": reseats every visible node.
  const [epoch, setEpoch] = useState(0);
  const [options, setOptions] = useGraphOptions();
  const [settings, setSettings] = useGraphSettings();
  const canvas = useRef<GraphCanvasHandle>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const sim = useMemo(() => new SimClient(), []);

  const { payload, cache, isLoading, isError } = useGraphData(
    scope,
    query,
    ready,
    settings.display.sizeBy === "plays",
  );

  // --- saving positions -----------------------------------------------------
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveNow = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const g = graphRef.current;
    if (!dirty.current || g.order === 0) return;
    dirty.current = false;
    const keys: string[] = [];
    const xy: number[] = [];
    g.forEachNode((key, a) => {
      // A node never shown has no position of its own. A key past the
      // boundary's limit (a very deep path with no content hash), or a
      // position that is not a number, would fail the whole save; that one
      // node just is not cached.
      if (!seated.current.has(key) || key.length > GRAPH_NODE_KEY_MAX) return;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return;
      keys.push(key);
      // Two decimals are plenty on a layout thousands of units wide, and
      // halve the file.
      xy.push(Math.round(a.x * 100) / 100, Math.round(a.y * 100) / 100);
    });
    api.graphLayoutSet(scope, keys, xy).catch((e: unknown) => {
      log.warn("failed to save the graph layout:", e);
    });
  }, [scope]);
  const scheduleSave = useCallback(() => {
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }, [saveNow]);
  useEffect(
    () => () => {
      sim.dispose();
      saveNow();
    },
    [sim, saveNow],
  );

  // --- the simulation's output ----------------------------------------------
  useEffect(() => {
    sim.setCallbacks({
      onPositions: (xy, gen) => {
        const s = simulated.current;
        if (gen !== s.gen) return;
        // Leaving before the simulation cools down still saves where it got.
        dirty.current = true;
        const held = holding.current;
        s.graph.updateEachNodeAttributes(
          (key, attrs) => {
            const i = s.index.get(key);
            if (i == null || key === held) return attrs;
            const x = xy[i * 2];
            const y = xy[i * 2 + 1];
            // In place: a fresh object per node per frame is GC churn.
            if (Number.isFinite(x) && Number.isFinite(y)) {
              attrs.x = x;
              attrs.y = y;
            }
            return attrs;
          },
          { attributes: ["x", "y"] },
        );
      },
      onIdle: (gen) => {
        if (gen !== simulated.current.gen || gen === 0) return;
        scheduleSave();
        if (refit.current) {
          refit.current = false;
          canvas.current?.fit();
        }
      },
    });
    return () => sim.setCallbacks(null);
  }, [sim, scheduleSave]);

  const physics = useMemo(() => physicsOf(settings.forces), [settings.forces]);
  useEffect(() => sim.setPhysics(physics), [sim, physics]);

  // --- a graph per payload --------------------------------------------------
  useEffect(() => {
    if (!payload || !cache) return;
    const prev = graphRef.current;
    const { graph: next, added } = buildGraphology(payload, prev);
    prev.forEachNode((key, a) => {
      if (!next.hasNode(key) && seated.current.has(key))
        lastSeen.current.set(key, [a.x, a.y]);
    });
    // Carried over, a node keeps its place; a newcomer takes where it last
    // stood, else its cached spot, else waits to be seated when shown.
    for (const key of added) {
      const p =
        lastSeen.current.get(key) ??
        (cacheStale.current ? undefined : cache.get(key));
      if (p) {
        next.mergeNodeAttributes(key, { x: p[0], y: p[1] });
        seated.current.add(key);
      } else {
        seated.current.delete(key);
      }
    }
    graphRef.current = next;
    // The graph lives outside React; this hands the new one over (and drops
    // a hover or pick the new data no longer contains).
    setGraph(next);
    setSelected((sel) => (sel && next.hasNode(sel) ? sel : null));
    setHovered((h) => (h && next.hasNode(h) ? h : null));
  }, [payload, cache]);

  // --- what shows ------------------------------------------------------------
  const visibility = useMemo(
    () => visibleSet(graph, options),
    [graph, options],
  );
  const focus = dragging ?? hovered ?? selected;

  // --- simulate what shows --------------------------------------------------
  useEffect(() => {
    const keys = [...visibility.nodes];
    const pending = keys.filter((k) => !seated.current.has(k));
    const seats = placeNodes(graph, pending, visibility, (key) => {
      if (!seated.current.has(key)) return null;
      const { x, y } = graph.getNodeAttributes(key);
      return [x, y];
    });
    if (seats.size > 0) {
      graph.updateEachNodeAttributes(
        (key, attrs) => {
          const p = seats.get(key);
          return p ? { ...attrs, x: p[0], y: p[1] } : attrs;
        },
        { attributes: ["x", "y"] },
      );
      for (const key of seats.keys()) seated.current.add(key);
    }

    const index = new Map(keys.map((k, i) => [k, i]));
    const xy = new Float32Array(keys.length * 2);
    keys.forEach((key, i) => {
      const { x, y } = graph.getNodeAttributes(key);
      xy[i * 2] = x;
      xy[i * 2 + 1] = y;
    });
    const links = new Uint32Array(visibility.edges.size * 2);
    let k = 0;
    for (const edge of visibility.edges) {
      const [a, b] = graph.extremities(edge);
      links[k++] = index.get(a) ?? 0;
      links[k++] = index.get(b) ?? 0;
    }
    const last = simulated.current;
    if (
      pending.length === 0 &&
      epoch === last.epoch &&
      sameArray(keys, last.keys) &&
      sameArray(links, last.links)
    ) {
      // The same picture (a refetch that changed nothing shown): the running
      // simulation already has it; only the graph it writes to is new.
      simulated.current = { ...last, graph };
      return;
    }
    // A drag in progress goes on over the new graph.
    const pins: { index: number; x: number; y: number }[] = [];
    const held = holding.current;
    const heldIndex = held != null ? index.get(held) : undefined;
    if (held != null && heldIndex != null) {
      const { x, y } = graph.getNodeAttributes(held);
      pins.push({ index: heldIndex, x, y });
    }
    const gen = sim.load({
      xy,
      links: links.slice(),
      // Mostly new, the graph starts hot, as a fresh one does in Obsidian.
      alpha: pending.length * 2 > keys.length ? 1 : REHEAT_ALPHA,
      pins,
    });
    simulated.current = { gen, graph, index, keys, links, epoch };
    if (!framed.current && keys.length > 0) {
      framed.current = true;
      refit.current = pending.length > 0;
      canvas.current?.fit(false);
    }
  }, [graph, visibility, sim, epoch]);

  const relayout = useCallback(() => {
    for (const key of visibility.nodes) seated.current.delete(key);
    lastSeen.current.clear();
    cacheStale.current = true;
    framed.current = false;
    setEpoch((e) => e + 1);
  }, [visibility]);

  // --- dragging -------------------------------------------------------------
  const dragStart = useCallback(
    (key: string) => {
      const i = simulated.current.index.get(key);
      const g = graphRef.current;
      if (i == null || !g.hasNode(key)) return false;
      holding.current = key;
      setDragging(key);
      const { x, y } = g.getNodeAttributes(key);
      sim.drag(i, x, y);
      return true;
    },
    [sim],
  );
  const drag = useCallback(
    (key: string, x: number, y: number) => {
      const i = simulated.current.index.get(key);
      if (i != null) sim.drag(i, x, y);
    },
    [sim],
  );
  const dragEnd = useCallback(
    (key: string) => {
      holding.current = null;
      setDragging(null);
      sim.release(simulated.current.index.get(key) ?? null);
    },
    [sim],
  );

  // --- actions ---------------------------------------------------------------
  const pick = useCallback((key: string) => {
    setSelected(key);
    canvas.current?.focus(key);
  }, []);
  const clearPick = useCallback(() => setSelected(null), []);
  // A click opens: a file in the detail, a tag as the list's filter.
  const open = useCallback(
    (key: string) => {
      const g = graphRef.current;
      const a = g.hasNode(key) ? g.getNodeAttributes(key) : null;
      if (a?.type === "file") void navigate(fileHref(a.fileId, a.workspaceId));
      else if (a?.type === "tag")
        onFilterToken(tagSearchToken(qualifiedTagName(a.namespace, a.name)));
    },
    [navigate, onFilterToken],
  );

  useEffect(() => {
    if (!keysActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping()) return;
      if (e.key === "Escape" && selected) {
        // Claimed, so the list's "Esc twice closes the window" stands down.
        e.preventDefault();
        clearPick();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        canvas.current?.fit();
      } else if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keysActive, selected, clearPick]);

  const searchBox = useMemo(
    () => (
      <GraphSearch
        graph={graph}
        visibility={visibility}
        onPick={pick}
        inputRef={searchInput}
      />
    ),
    [graph, visibility, pick],
  );

  const zoomIn = useCallback(() => canvas.current?.zoomIn(), []);
  const zoomOut = useCallback(() => canvas.current?.zoomOut(), []);
  const fit = useCallback(() => canvas.current?.fit(), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const cameraInput = useCallback(() => {
    refit.current = false;
  }, []);

  const empty = !!payload && visibility.nodes.size === 0;

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="graph-view">
      <GraphToolbar
        search={searchBox}
        options={options}
        onOptions={setOptions}
        onRelayout={relayout}
        settingsOpen={panelOpen}
        onSettings={setPanelOpen}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden bg-bg">
        <GraphErrorBoundary
          fallback={
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
              {t("graph.unavailable")}
            </div>
          }
        >
          <GraphCanvas
            ref={canvas}
            graph={graph}
            colors={colors}
            visibility={visibility}
            focus={focus}
            display={settings.display}
            onHover={setHovered}
            onClickNode={open}
            onClickStage={clearPick}
            onDragStart={dragStart}
            onDrag={drag}
            onDragEnd={dragEnd}
            onCameraInput={cameraInput}
          />
        </GraphErrorBoundary>

        {(isLoading || isError || empty) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            {isLoading ? (
              <p className="text-sm text-muted">{t("graph.loading")}</p>
            ) : isError ? (
              <p className="text-sm text-muted">{t("graph.loadFailed")}</p>
            ) : (
              <>
                <Share2 className="size-10 text-muted opacity-60" />
                <p className="text-sm text-fg">{t("graph.empty.title")}</p>
                <p className="max-w-sm text-xs text-muted">
                  {t("graph.empty.hint")}
                </p>
              </>
            )}
          </div>
        )}

        {payload?.truncated && (
          <p
            role="status"
            className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-border bg-surface/90 px-3 py-1 text-xs text-secondary-fg shadow"
          >
            {t("graph.truncated", {
              shown: payload.files.id.length.toLocaleString(),
              total: payload.totalFiles.toLocaleString(),
            })}
          </p>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3">
          <GraphLegend showAutoTags={options.showAutoTags} />
        </div>

        {panelOpen && (
          <div className="absolute right-[4.25rem] top-3 max-h-[calc(100%-1.5rem)] overflow-y-auto">
            <GraphSettingsPanel
              settings={settings}
              onChange={setSettings}
              onClose={closePanel}
            />
          </div>
        )}

        <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg border border-border bg-surface/90 shadow">
          <CameraButton label={t("graph.zoomIn")} onClick={zoomIn}>
            <Plus className="size-4" />
          </CameraButton>
          <CameraButton label={t("graph.zoomOut")} onClick={zoomOut}>
            <Minus className="size-4" />
          </CameraButton>
          <CameraButton label={t("graph.fit")} onClick={fit}>
            <Maximize className="size-4" />
          </CameraButton>
        </div>
      </div>
    </div>
  );
}
