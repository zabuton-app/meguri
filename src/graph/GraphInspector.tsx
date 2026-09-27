// The panel beside the canvas: an overview while nothing is selected, else the
// selected file (thumbnail, tags, related files) or tag (its files). Built from
// the graph alone: fetching the file's detail would record an access.
import { memo, useMemo } from "react";
import { ExternalLink, Filter, ImageOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { kindLabelKey } from "@/lib/mediaKind";
import { thumbUrl } from "@/lib/thumbUrl";
import {
  relatedFiles,
  tagFiles,
  topHubs,
  type RelatedFile,
} from "./model/related";
import type { FileNodeAttrs, MediaGraph, NodeAttrs } from "./model/types";
import type { Visibility } from "./model/visibility";
import { NodeDot } from "./NodeDot";

/** Rows a list shows; the rest is summarised as a count. */
export const INSPECTOR_LIST_MAX = 200;
const HUBS = 5;

interface Props {
  graph: MediaGraph;
  visibility: Visibility;
  selected: string | null;
  mediaBase: string;
  onSelect: (key: string) => void;
  onOpen: (key: string) => void;
  onFilterTag: (key: string) => void;
  onClear: () => void;
}

function NodeRow({
  graph,
  node,
  sub,
  bar,
  onSelect,
}: {
  graph: MediaGraph;
  node: string;
  sub?: string;
  /** 0..1 strength drawn as a bar, when there is one. */
  bar?: number;
  onSelect: (key: string) => void;
}) {
  const attrs = graph.getNodeAttributes(node);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node)}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition hover:bg-fg/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <NodeDot node={attrs} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-fg">{attrs.label}</span>
          {sub && <span className="truncate text-xs text-muted">{sub}</span>}
        </span>
        {bar != null && (
          <span
            aria-hidden
            className="h-1 w-12 shrink-0 overflow-hidden rounded bg-border"
          >
            <span
              className="block h-full bg-accent2"
              style={{ width: `${Math.round(Math.min(1, bar) * 100)}%` }}
            />
          </span>
        )}
      </button>
    </li>
  );
}

function FileList({
  graph,
  rows,
  withShared,
  onSelect,
}: {
  graph: MediaGraph;
  rows: RelatedFile[];
  withShared: boolean;
  onSelect: (key: string) => void;
}) {
  const { t } = useI18n();
  const top = rows[0]?.score || 1;
  const shown = rows.slice(0, INSPECTOR_LIST_MAX);
  return (
    <>
      <ul className="flex flex-col gap-0.5">
        {shown.map((r) => (
          <NodeRow
            key={r.key}
            graph={graph}
            node={r.key}
            sub={
              withShared && r.shared.length
                ? t("graph.inspector.sharedTags", { tags: r.shared.join(", ") })
                : undefined
            }
            bar={withShared ? r.score / top : undefined}
            onSelect={onSelect}
          />
        ))}
      </ul>
      {rows.length > shown.length && (
        <p className="px-2.5 py-2 text-xs text-muted">
          +{t("graph.inspector.count", { count: rows.length - shown.length })}
        </p>
      )}
    </>
  );
}

function Overview({
  graph,
  visibility,
  onSelect,
}: {
  graph: MediaGraph;
  visibility: Visibility;
  onSelect: (key: string) => void;
}) {
  const { t } = useI18n();
  const { files, tags, hubs } = useMemo(() => {
    let files = 0;
    let tags = 0;
    for (const key of visibility.nodes) {
      if (graph.getNodeAttribute(key, "type") === "tag") tags++;
      else files++;
    }
    return {
      files,
      tags,
      hubs: topHubs(visibility.nodes, visibility.degree, HUBS),
    };
  }, [graph, visibility]);
  const stats = [
    { label: t("graph.inspector.files"), value: files },
    { label: t("graph.inspector.tags"), value: tags },
    { label: t("graph.inspector.links"), value: visibility.edges.size },
  ];
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-base font-semibold text-bright-fg">
        {t("graph.inspector.overview")}
      </h2>
      <dl className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-surface px-3 py-2">
            <dd className="font-mono text-lg text-bright-fg tabular-nums">
              {s.value.toLocaleString()}
            </dd>
            <dt className="text-xs text-secondary-fg">{s.label}</dt>
          </div>
        ))}
      </dl>
      <p className="text-sm leading-relaxed text-secondary-fg">
        {t("graph.inspector.hint")}
      </p>
      {hubs.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs text-muted">
            {t("graph.inspector.hubs")}
          </h3>
          <ul className="flex flex-col gap-0.5">
            {hubs.map((h) => (
              <NodeRow
                key={h.key}
                graph={graph}
                node={h.key}
                sub={t("graph.inspector.count", { count: h.degree })}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Thumbnail({
  file,
  mediaBase,
}: {
  file: FileNodeAttrs;
  mediaBase: string;
}) {
  const { t } = useI18n();
  const src = file.hasThumb
    ? thumbUrl(mediaBase, file.workspaceId, file.fileId)
    : null;
  return src ? (
    <img
      src={src}
      alt=""
      className="aspect-video w-full rounded-lg border border-border bg-surface object-contain"
    />
  ) : (
    <div className="flex aspect-video w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface text-xs text-muted">
      <ImageOff className="size-4" />
      {t("graph.inspector.noThumb")}
    </div>
  );
}

// Memoised: hovering re-renders the view on every node the pointer crosses,
// and nothing the inspector shows depends on the hover.
export const GraphInspector = memo(function GraphInspector({
  graph,
  visibility,
  selected,
  mediaBase,
  onSelect,
  onOpen,
  onFilterTag,
  onClear,
}: Props) {
  const { t } = useI18n();
  const attrs: NodeAttrs | null =
    selected && graph.hasNode(selected)
      ? graph.getNodeAttributes(selected)
      : null;

  const rows = useMemo(() => {
    if (!selected || !attrs) return [];
    return attrs.type === "file"
      ? relatedFiles(graph, selected, visibility.edges)
      : tagFiles(graph, selected, visibility.edges);
    // `attrs` follows from graph and selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, selected, visibility]);

  const fileTags = useMemo(() => {
    if (!selected || attrs?.type !== "file") return [];
    const out: string[] = [];
    graph.forEachEdge(selected, (edge, _a, a, b) => {
      const other = a === selected ? b : a;
      if (
        visibility.edges.has(edge) &&
        graph.getNodeAttribute(other, "type") === "tag"
      )
        out.push(other);
    });
    return out.sort((x, y) =>
      graph
        .getNodeAttribute(x, "label")
        .localeCompare(graph.getNodeAttribute(y, "label")),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, selected, visibility]);

  return (
    <aside
      aria-label={t("graph.inspector.label")}
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-bg pb-40"
      data-slot="graph-inspector"
    >
      {!selected || !attrs ? (
        <Overview graph={graph} visibility={visibility} onSelect={onSelect} />
      ) : (
        <div className="flex flex-col gap-3 p-4">
          {attrs.type === "file" && (
            <Thumbnail file={attrs} mediaBase={mediaBase} />
          )}
          <div className="flex items-center gap-2 text-xs text-muted">
            <NodeDot node={attrs} />
            {attrs.type === "tag"
              ? t(attrs.auto ? "graph.legend.autoTag" : "graph.legend.tag")
              : (() => {
                  const key = kindLabelKey(attrs.fileKind);
                  return key ? t(key) : attrs.fileKind;
                })()}
          </div>
          <h2 className="break-all text-base font-semibold text-bright-fg">
            {attrs.label}
          </h2>
          {attrs.type === "file" && (
            <p className="break-all text-xs text-muted">{attrs.relPath}</p>
          )}
          {fileTags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {fileTags.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    onClick={() => onSelect(tag)}
                    className="h-7 rounded-full border border-border bg-surface px-2.5 text-xs text-accent2 transition hover:bg-fg/10"
                  >
                    {graph.getNodeAttribute(tag, "label")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            {attrs.type === "file" ? (
              <Button
                size="sm"
                className="h-9 flex-1"
                onClick={() => onOpen(selected)}
              >
                <ExternalLink />
                {t("graph.inspector.open")}
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-9 flex-1"
                onClick={() => onFilterTag(selected)}
              >
                <Filter />
                {t("graph.inspector.searchTag")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              onClick={onClear}
              aria-label={t("graph.inspector.clear")}
              title={t("graph.inspector.clear")}
            >
              <X />
            </Button>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <h3 className="text-xs text-muted">
              {t(
                attrs.type === "file"
                  ? "graph.inspector.related"
                  : "graph.inspector.tagFiles",
              )}
            </h3>
            <span className="font-mono text-xs text-muted">
              {t("graph.inspector.count", { count: rows.length })}
            </span>
          </div>
          <FileList
            graph={graph}
            rows={rows}
            withShared={attrs.type === "file"}
            onSelect={onSelect}
          />
        </div>
      )}
    </aside>
  );
});
