// Cross-file play-history timeline. /history. Lists play events newest-first
// (consecutive re-plays of the same file are collapsed main-process-side),
// grouped by day, with a clear-all action. Overlays the list as a modal.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { History as HistoryIcon, Trash2, X } from "lucide-react";
import { api } from "@/ipc/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { fileHref } from "@/lib/fileHref";
import { formatDuration } from "@/lib/format";
import type { HistoryEntryRow } from "@/ipc/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { useConfirm } from "@/components/ConfirmDialog";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import { HistoryModal } from "./HistoryModal";

const PAGE_SIZE = 50;

/** Day bucket label: today / yesterday / locale date. Calendar-day comparison
 *  (not ms arithmetic) so DST transitions can't shift the bucket boundaries. */
function dayLabel(playedAt: number, t: TFunc): string {
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
  return day.toLocaleDateString();
}

export default function History() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const onClose = useCallback(() => {
    void navigate("/");
  }, [navigate]);

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

  const history = useInfiniteQuery({
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

  // Fetch the next page when the sentinel at the bottom of the list scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = history;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, items.length]);

  const clear = useMutation({
    mutationFn: () => api.historyClear(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["history_list"] });
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

  // Day groups, preserving the newest-first order within and across groups.
  const groups = useMemo(() => {
    const out: { label: string; rows: HistoryEntryRow[] }[] = [];
    for (const row of items) {
      const label = dayLabel(row.playedAt, t);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(row);
      else out.push({ label, rows: [row] });
    }
    return out;
  }, [items, t]);

  const loading = ready && history.isLoading;

  return (
    <HistoryModal onClose={onClose}>
      <header className="flex items-center gap-2 border-b border-border bg-bg px-3 py-2.5">
        <HistoryIcon className="size-4 text-primary" />
        <span className="text-sm font-medium text-fg">
          {t("history.title")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {items.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => void onClear()}
              disabled={clear.isPending}
            >
              <Trash2 />
              {t("history.clear")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onClose}
            title={`${t("common.close")} (Esc)`}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
            <HistoryIcon className="size-10 opacity-50" />
            <p>{t("history.empty")}</p>
            <p className="text-xs">{t("history.emptyHint")}</p>
          </div>
        ) : (
          <div className="flex flex-col p-3">
            {groups.map((g) => (
              <section key={g.label}>
                <h3 className="sticky top-0 z-10 bg-bg px-1 py-1.5 text-xs font-semibold uppercase text-muted">
                  {g.label}
                </h3>
                <ul className="flex flex-col gap-1">
                  {g.rows.map((row) => (
                    <li key={`${row.workspaceId}:${row.historyId}`}>
                      <Link
                        to={fileHref(row.id, row.workspaceId, {
                          autoplay: false,
                        })}
                        className="group/thumb flex items-center gap-3 rounded-lg p-1.5 transition hover:bg-fg/5"
                      >
                        <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-surface">
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
                          <span
                            className="block truncate text-sm text-fg"
                            title={row.relPath}
                          >
                            {row.relPath.split("/").pop()}
                          </span>
                          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                            <span className="tabular-nums">
                              {new Date(row.playedAt * 1000).toLocaleString()}
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
                            {showWsLabel && wsLabels.get(row.workspaceId) && (
                              <span className="truncate">
                                {wsLabels.get(row.workspaceId)}
                              </span>
                            )}
                          </span>
                        </span>
                        {row.duration ? (
                          <span className="shrink-0 text-xs tabular-nums text-muted">
                            {formatDuration(row.duration)}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {hasNextPage && <div ref={sentinelRef} className="h-8" />}
          </div>
        )}
      </div>
    </HistoryModal>
  );
}
