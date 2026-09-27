// The graph view mode: the current list's files and their tags as a network.
// Each payload builds a new graphology graph that takes over the positions of
// the one before, so a refetch keeps the picture, the camera (one sigma for
// the component, keyed by scope in Home) and the selection. Positions come
// from what is on screen, the scope's layout cache, the force layout (in a
// worker) or, for the first frame, placement.ts.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { Maximize, Minus, Plus, Share2 } from "lucide-react";
import { tagSearchToken, qualifiedTagName } from "@shared/tags";
import { api } from "@/ipc/client";
import type { SearchQuery } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { fileHref } from "@/lib/fileHref";
import log from "@/lib/logger";
import { buildGraphology, emptyGraph } from "./model/buildGraphology";
import {
  layoutPlan,
  placeNodes,
  seedPosition,
  seedRadius,
  type LayoutPlan,
  type Point,
} from "./model/placement";
import type { MediaGraph } from "./model/types";
import { visibleSet } from "./model/visibility";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import { GraphErrorBoundary } from "./GraphErrorBoundary";
import { GraphInspector } from "./GraphInspector";
import { GraphLegend } from "./GraphLegend";
import { GraphSearch } from "./GraphSearch";
import { GraphToolbar } from "./GraphToolbar";
import { useGraphOptions } from "./graphOptions";
import { LayoutClient } from "./layoutClient";
import { LAYOUT_BUDGET_MS, maxIterationsFor } from "./layoutProtocol";
import { GRAPH_NODE_KEY_MAX } from "@shared/ipc/graph";
import { useGraphColors } from "./useGraphColors";
import { useGraphData } from "./useGraphData";

/** Positions are written this long after the layout last settled. */
const SAVE_DEBOUNCE_MS = 2_000;

interface Props {
  /** Active target: workspace id, "__all__" or "collection:<id>". */
  scope: string;
  query: SearchQuery;
  mediaBase: string;
  ready: boolean;
  /** Keyboard shortcuts apply (the list is in front, no overlay). */
  keysActive: boolean;
  /** Add a search token to the list's filter (a tag, from the inspector). */
  onFilterToken: (token: string) => void;
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

/** Generated tags stay out of the force layout (they would pull every file
 *  together) and sit at the centre of the files they tag instead. */
function isAutoTag(graph: MediaGraph, key: string): boolean {
  const a = graph.getNodeAttributes(key);
  return a.type === "tag" && a.auto;
}

function centreAutoTags(graph: MediaGraph): void {
  graph.forEachNode((key, attrs) => {
    if (attrs.type !== "tag" || !attrs.auto) return;
    let sx = 0;
    let sy = 0;
    let n = 0;
    graph.forEachNeighbor(key, (_other, o) => {
      sx += o.x;
      sy += o.y;
      n++;
    });
    if (n > 0) graph.mergeNodeAttributes(key, { x: sx / n, y: sy / n });
  });
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
  mediaBase,
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
  // Where nodes that a filter took off the screen last stood, so they come
  // back there rather than at the (older) cached spot.
  const lastSeen = useRef(new Map<string, Point>());
  // After a re-layout the cache describes the old picture.
  const cacheStale = useRef(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [local, setLocal] = useState(false);
  const [depth, setDepth] = useState(1);
  const [options, setOptions] = useGraphOptions();
  const canvas = useRef<GraphCanvasHandle>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const layout = useMemo(() => new LayoutClient(), []);
  const layoutRunning = useSyncExternalStore(
    layout.subscribe,
    layout.isRunning,
  );

  const { payload, cache, isLoading, isError } = useGraphData(
    scope,
    query,
    ready,
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
      // A key past the boundary's limit (a very deep path with no content
      // hash) would fail the whole save; that one node just is not cached.
      if (key.length > GRAPH_NODE_KEY_MAX) return;
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
      layout.dispose();
      saveNow();
    },
    [layout, saveNow],
  );

  // --- layout ---------------------------------------------------------------
  const runLayout = useCallback(
    (graph: MediaGraph, plan: LayoutPlan, pinned: Set<string>) => {
      if (plan === "none") return;
      const keys = graph.filterNodes((key) => !isAutoTag(graph, key));
      const index = new Map(keys.map((k, i) => [k, i]));
      const xy = new Float32Array(keys.length * 2);
      const fixed = new Uint8Array(keys.length);
      keys.forEach((k, i) => {
        const a = graph.getNodeAttributes(k);
        xy[i * 2] = a.x;
        xy[i * 2 + 1] = a.y;
        fixed[i] = plan === "fixed-partial" && pinned.has(k) ? 1 : 0;
      });
      const ea: number[] = [];
      const eb: number[] = [];
      const w: number[] = [];
      graph.forEachEdge((_e, attrs, a, b) => {
        const ia = index.get(a);
        const ib = index.get(b);
        if (ia == null || ib == null) return;
        ea.push(ia);
        eb.push(ib);
        w.push(attrs.weight);
      });
      layout.run(
        {
          xy,
          fixed,
          ea: Uint32Array.from(ea),
          eb: Uint32Array.from(eb),
          weight: Float32Array.from(w),
          maxIterations: maxIterationsFor(keys.length),
          budgetMs: LAYOUT_BUDGET_MS,
        },
        {
          onPositions: (pos) => {
            graph.updateEachNodeAttributes(
              (key, attrs) => {
                const i = index.get(key);
                if (i == null) return attrs;
                return { ...attrs, x: pos[i * 2], y: pos[i * 2 + 1] };
              },
              { attributes: ["x", "y"] },
            );
            centreAutoTags(graph);
          },
          onDone: scheduleSave,
        },
      );
    },
    [layout, scheduleSave],
  );

  // --- a graph per payload --------------------------------------------------
  useEffect(() => {
    if (!payload || !cache) return;
    const prev = graphRef.current;
    const { graph: next, added } = buildGraphology(payload, prev);
    prev.forEachNode((key, a) => {
      if (!next.hasNode(key)) lastSeen.current.set(key, [a.x, a.y]);
    });
    // On screen (carried over) wins; then where a node last stood; then the
    // cache; then a fresh seat.
    const addedSet = new Set(added);
    const known = new Map<string, Point>(cacheStale.current ? [] : cache);
    for (const [key, p] of lastSeen.current) known.set(key, p);
    next.forEachNode((key, a) => {
      if (!addedSet.has(key)) known.set(key, [a.x, a.y]);
    });
    const positions = placeNodes(next, added, known);
    for (const [key, [x, y]] of positions)
      next.mergeNodeAttributes(key, { x, y });
    centreAutoTags(next);

    const unplaced = new Set(
      added.filter((k) => !known.has(k) && !isAutoTag(next, k)),
    );
    const pinned = new Set(next.filterNodes((k) => !unplaced.has(k)));
    let plan = layoutPlan(
      next.filterNodes((k) => !isAutoTag(next, k)).length,
      unplaced.size,
    );
    // A layout still settling was working on the previous graph: carry on
    // with this one rather than freeze half-way.
    if (plan === "none" && layout.isRunning()) plan = "full";
    graphRef.current = next;
    // The graph lives outside React; this hands the new one over (and drops
    // a selection or hover the new data no longer contains).
    setGraph(next);
    setSelected((sel) => (sel && next.hasNode(sel) ? sel : null));
    setHovered((h) => (h && next.hasNode(h) ? h : null));
    if (plan !== "none") runLayout(next, plan, pinned);
    else if (added.length > 0) scheduleSave();
  }, [payload, cache, layout, runLayout, scheduleSave]);

  const relayout = useCallback(() => {
    const g = graphRef.current;
    const radius = seedRadius(g.order);
    g.updateEachNodeAttributes(
      (key, attrs) => {
        const [x, y] = seedPosition(key, radius);
        return { ...attrs, x, y };
      },
      { attributes: ["x", "y"] },
    );
    centreAutoTags(g);
    lastSeen.current.clear();
    cacheStale.current = true;
    runLayout(g, "full", new Set());
  }, [runLayout]);

  // --- what shows ------------------------------------------------------------
  const localFocus = local && selected ? selected : null;
  const visibility = useMemo(
    () =>
      visibleSet(
        graph,
        options,
        localFocus ? { node: localFocus, depth } : null,
      ),
    [graph, options, localFocus, depth],
  );
  // A local graph already is the selection's neighbourhood: dimming the
  // part of it past depth 1 would hide what was asked for. Hover still works.
  const focus = hovered ?? (localFocus ? null : selected);

  // --- actions ---------------------------------------------------------------
  const select = useCallback((key: string) => {
    setSelected(key);
    canvas.current?.focus(key);
  }, []);
  const clearSelection = useCallback(() => {
    setSelected(null);
    setLocal(false);
  }, []);
  const open = useCallback(
    (key: string) => {
      const a = graph.hasNode(key) ? graph.getNodeAttributes(key) : null;
      if (a?.type === "file") void navigate(fileHref(a.fileId, a.workspaceId));
    },
    [graph, navigate],
  );
  const filterTag = useCallback(
    (key: string) => {
      const a = graph.hasNode(key) ? graph.getNodeAttributes(key) : null;
      if (a?.type === "tag")
        onFilterToken(tagSearchToken(qualifiedTagName(a.namespace, a.name)));
    },
    [graph, onFilterToken],
  );
  const onDoubleClickNode = useCallback(
    (key: string) => {
      if (graph.getNodeAttribute(key, "type") === "file") open(key);
      else filterTag(key);
    },
    [graph, open, filterTag],
  );

  useEffect(() => {
    if (!keysActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping()) return;
      if (e.key === "Escape" && selected) {
        // Claimed, so the list's "Esc twice closes the window" stands down.
        e.preventDefault();
        clearSelection();
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
  }, [keysActive, selected, clearSelection]);

  const searchBox = useMemo(
    () => (
      <GraphSearch
        graph={graph}
        visibility={visibility}
        onPick={select}
        inputRef={searchInput}
      />
    ),
    [graph, visibility, select],
  );

  const zoomIn = useCallback(() => canvas.current?.zoomIn(), []);
  const zoomOut = useCallback(() => canvas.current?.zoomOut(), []);
  const fit = useCallback(() => canvas.current?.fit(), []);

  const empty = !!payload && visibility.nodes.size === 0;

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="graph-view">
      <GraphToolbar
        search={searchBox}
        options={options}
        onOptions={setOptions}
        local={local}
        canLocal={!!selected}
        onLocal={setLocal}
        depth={depth}
        onDepth={setDepth}
        layoutRunning={layoutRunning}
        onRelayout={relayout}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-hidden bg-bg">
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
              selected={selected}
              onHover={setHovered}
              onClickNode={select}
              onDoubleClickNode={onDoubleClickNode}
              onClickStage={clearSelection}
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
        <GraphInspector
          graph={graph}
          visibility={visibility}
          selected={selected}
          mediaBase={mediaBase}
          onSelect={select}
          onOpen={open}
          onFilterTag={filterTag}
          onClear={clearSelection}
        />
      </div>
    </div>
  );
}
