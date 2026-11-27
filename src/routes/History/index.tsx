// Cross-file play-history timeline. /history. Lists play events newest-first
// (consecutive re-plays of the same file are collapsed main-process-side),
// grouped by day, with a clear-all action. Overlays the list as a modal.
import { useCallback, useId, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router";
import {
  type InfiniteData,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  History as HistoryIcon,
  Maximize2,
  Minimize2,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/ipc/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useInfiniteScrollTrigger } from "@/hooks/useInfiniteScrollTrigger";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { ModalSize } from "@/routes/MediaDetail/MediaModal";
import { fileHref } from "@/lib/fileHref";
import { invalidateFileCaches } from "@/lib/queryCache";
import { formatDuration } from "@/lib/format";
import { fileNameOf } from "@/lib/relPath";
import type { HistoryEntryRow, HistoryPage, HistoryQuery } from "@/ipc/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { useConfirm } from "@/components/ConfirmDialog";
import { LoadError } from "@/components/LoadError";
import { useI18n, type Lang, type TFunc } from "@/i18n/I18nProvider";
import { formatDate, formatDateTime } from "@/lib/dates";
import { HistoryModal } from "./HistoryModal";

const PAGE_SIZE = 50;
const MODAL_SIZE_KEY = "meguri.history.modalSize";
/** Estimates until a row is measured: a day header, and an entry with its gap. */
const HEADER_H = 28;
const ENTRY_H = 70;
/** The list's padding, top and bottom (p-3). */
const LIST_PAD = 12;

/** One row of the virtualized list: a day's header or a play event. */
type ListRow =
  | { kind: "header"; label: string; key: string }
  | { kind: "entry"; entry: HistoryEntryRow; key: string };

/** Day bucket label: today / yesterday / locale date. Calendar-day comparison
 *  (not ms arithmetic) so DST transitions can't shift the bucket boundaries. */
function dayLabel(playedAt: number, t: TFunc, lang: Lang): string {
  const day = new Date(playedAt * 1000);
  const today = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(day, today)) return t("history.today");
  // Rolling the date back by one lets Date normalize month/year boundaries.
  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  );
  if (sameDay(day, yesterday)) return t("history.yesterday");
  return formatDate(day, lang);
}

export default function History() {
  const { t, lang } = useI18n();
  const titleId = useId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const onClose = useCallback(() => {
    void navigate("/");
  }, [navigate]);
  // Persisted large/small toggle, same UX as MediaDetail's modal (own key so
  // the history panel remembers its size independently of the detail view).
  const [modalSize, setModalSize] = useLocalStorage<ModalSize>(
    MODAL_SIZE_KEY,
    "small",
    (raw) => (raw === "large" ? "large" : "small"),
  );
  const toggleModalSize = useCallback(
    () => setModalSize((prev) => (prev === "small" ? "large" : "small")),
    [setModalSize],
  );

  const status = useAppStatus();
  const ready = status.data?.ready ?? false;
  const mediaBase = status.data?.mediaBase ?? "";
  const wsId = status.data?.workspaceId ?? "";

  // Workspace labels for the All view (rows carry only workspace IDs).
  const wsList = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
    enabled: ready,
  });
  const wsLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of wsList.data?.workspaces ?? []) map.set(w.id, w.label);
    return map;
  }, [wsList.data]);
  // The list always contains the virtual "All" entry, so > 2 means multiple real roots.
  const showWsLabel = wsLabels.size > 2;

  const history = useInfiniteQuery<
    HistoryPage,
    Error,
    InfiniteData<HistoryPage>,
    QueryKey,
    HistoryQuery["cursor"]
  >({
    queryKey: ["history_list", wsId],
    queryFn: ({ pageParam }) =>
      api.historyList({ cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: ready,
  });
  const items = useMemo(
    () => history.data?.pages.flatMap((p) => p.items) ?? [],
    [history.data],
  );

  const clear = useMutation({
    mutationFn: () => api.historyClear(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["history_list"] });
      // Nothing counts as played any more, and resume points go with the
      // history (see clearPlayHistory); the lists' and graph's played state,
      // progress bars and the detail's start position are read from these.
      invalidateFileCaches(qc);
      // Dropped, not just marked stale: the detail view settles where to
      // start from the first data it sees, and a cached copy would hand it
      // the resume point that was just cleared (which it then writes back).
      qc.removeQueries({ queryKey: ["file_get"], type: "inactive" });
    },
  });
  const onClear = useCallback(async () => {
    const ok = await confirm({
      title: t("history.clear"),
      message: t("history.clearConfirm"),
      confirmText: t("history.clearAction"),
      destructive: true,
    });
    if (ok) clear.mutate();
  }, [clear, confirm, t]);

  // Day headers between the entries, newest first. Flat, so the list only
  // mounts the rows in view: history grows without bound as pages load.
  const rows = useMemo(() => {
    const out: ListRow[] = [];
    let label = "";
    for (const entry of items) {
      const day = dayLabel(entry.playedAt, t, lang);
      if (day !== label) {
        label = day;
        out.push({ kind: "header", label: day, key: `day:${day}` });
      }
      out.push({
        kind: "entry",
        entry,
        key: `${entry.workspaceId}:${entry.historyId}`,
      });
    }
    return out;
  }, [items, t, lang]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
  }, []);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === "header" ? HEADER_H : ENTRY_H),
    getItemKey: (i) => rows[i]?.key ?? i,
    paddingStart: LIST_PAD,
    paddingEnd: LIST_PAD,
    overscan: 8,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const { hasNextPage, isFetchingNextPage } = history;
  const fetchNext = history.fetchNextPage;
  const fetchNextPage = useCallback(() => void fetchNext(), [fetchNext]);
  useInfiniteScrollTrigger({
    virtualRows,
    totalRows: rows.length,
    threshold: 10,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  });

  // The header of the day at the top, once its own header has scrolled out.
  // Rows are placed by transform, where `position: sticky` has nothing to
  // hold on to, so it is drawn over the list instead (as in the timeline).
  const scrollOffset = virtualizer.scrollOffset ?? 0;
  const pinnedHeader = useMemo(() => {
    const top = virtualRows.find((vr) => vr.end > scrollOffset);
    if (!top) return null;
    for (let i = top.index; i >= 0; i--) {
      const row = rows[i];
      if (row?.kind !== "header") continue;
      return i === top.index && top.start >= scrollOffset ? null : row.label;
    }
    return null;
  }, [virtualRows, rows, scrollOffset]);

  const loading = ready && history.isLoading;

  const isSmall = modalSize === "small";
  const toggleLabel = isSmall
    ? t("media.modalMaximize")
    : t("media.modalMinimize");
  return (
    <HistoryModal onClose={onClose} size={modalSize} titleId={titleId}>
      <header className="flex items-center gap-2 border-b border-border bg-bg px-3 py-2.5">
        <HistoryIcon className="size-4 text-primary" />
        <span id={titleId} className="text-sm font-medium text-fg">
          {t("history.title")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {items.length > 0 && (
            <Button
              variant="outline"
              size="compact"
              onClick={() => void onClear()}
              disabled={clear.isPending}
            >
              <Trash2 />
              {t("history.clear")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="compact"
            onClick={toggleModalSize}
            aria-label={toggleLabel}
            aria-pressed={isSmall}
            title={toggleLabel}
          >
            {isSmall ? <Maximize2 /> : <Minimize2 />}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            onClick={onClose}
            title={`${t("common.close")} (Esc)`}
          >
            <X />
          </Button>
        </div>
      </header>

      {history.isError && !history.data ? (
        <LoadError
          message={t("history.loadFailed")}
          onRetry={() => void history.refetch()}
          retrying={history.isFetching}
        />
      ) : !loading && items.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center text-muted">
          <HistoryIcon className="size-10 opacity-50" />
          <p>{t("history.empty")}</p>
          <p className="text-xs">{t("history.emptyHint")}</p>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <ScrollArea className="page-scroll h-full" viewportRef={setScrollRef}>
            {loading ? (
              <div className="flex flex-col gap-2 p-4">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-card" />
                ))}
              </div>
            ) : (
              <div
                className="relative mx-3"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualRows.map((vr) => {
                  const row = rows[vr.index];
                  if (!row) return null;
                  return (
                    <div
                      key={vr.key}
                      data-index={vr.index}
                      ref={virtualizer.measureElement}
                      className="absolute left-0 top-0 w-full"
                      style={{ transform: `translateY(${vr.start}px)` }}
                    >
                      {row.kind === "header" ? (
                        <DayHeader label={row.label} />
                      ) : (
                        <div className="pb-1">
                          <HistoryEntry
                            row={row.entry}
                            mediaBase={mediaBase}
                            wsLabel={
                              showWsLabel
                                ? wsLabels.get(row.entry.workspaceId)
                                : undefined
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
          {pinnedHeader && (
            <div
              className="pointer-events-none absolute inset-x-3 top-0 z-10"
              aria-hidden
            >
              <DayHeader label={pinnedHeader} />
            </div>
          )}
        </div>
      )}
    </HistoryModal>
  );
}

function DayHeader({ label }: { label: string }) {
  return (
    <h3 className="bg-bg px-1 py-1.5 text-xs font-semibold uppercase text-muted">
      {label}
    </h3>
  );
}

function HistoryEntry({
  row,
  mediaBase,
  wsLabel,
}: {
  row: HistoryEntryRow;
  mediaBase: string;
  /** The workspace's name, when there are several to tell apart. */
  wsLabel?: string;
}) {
  const { t, lang } = useI18n();
  return (
    <Link
      to={fileHref(row.id, row.workspaceId, {
        autoplay: false,
      })}
      className="group/thumb flex items-center gap-3 rounded-card p-1.5 transition hover:bg-fg/10"
    >
      <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-item bg-surface">
        <MediaThumbnail
          file={row}
          mediaBase={mediaBase}
          version={0}
          fallbackIconSize="size-5"
          playOverlaySize="size-7"
          playIconSize="size-3.5"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-fg" title={row.relPath}>
          {fileNameOf(row.relPath)}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          <span className="tabular-nums">
            {formatDateTime(new Date(row.playedAt * 1000), lang)}
          </span>
          <Badge variant="outline" className="font-normal">
            {row.via === "external"
              ? t("history.viaExternal")
              : t("history.viaBrowser")}
          </Badge>
          {row.playCount > 1 && (
            <span>
              {t("history.playCount", {
                count: row.playCount,
              })}
            </span>
          )}
          {wsLabel && <span className="truncate">{wsLabel}</span>}
        </span>
      </span>
      {row.duration ? (
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {formatDuration(row.duration)}
        </span>
      ) : null}
    </Link>
  );
}
