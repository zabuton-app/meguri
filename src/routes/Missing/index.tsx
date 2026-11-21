// Files the last scan did not find on disk, removed by the user's choice.
// /missing. Why it is the user's call: see electron/core/queries/missing.ts.
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileX, Maximize2, Minimize2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { ModalSize } from "@/routes/MediaDetail/MediaModal";
import { bulkTargets } from "@/lib/bulkEdit";
import { dirOf, fileNameOf } from "@/lib/relPath";
import type { MissingFileRow } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { useConfirm } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n/I18nProvider";
import { HistoryModal } from "@/routes/History/HistoryModal";

const MODAL_SIZE_KEY = "meguri.missing.modalSize";
/** Every row is one fixed-size thumbnail beside two lines of text. */
const ROW_HEIGHT = 68;

const keyOf = (row: MissingFileRow) => `${row.workspaceId}:${row.id}`;

export default function Missing() {
  const { t, lang } = useI18n();
  const titleId = useId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const onClose = useCallback(() => {
    void navigate("/");
  }, [navigate]);
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

  const missing = useQuery({
    queryKey: ["missing_files", wsId],
    queryFn: api.missingFilesList,
    enabled: ready,
  });
  const items = useMemo(() => missing.data?.items ?? [], [missing.data]);
  const total = missing.data?.total ?? 0;

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Only rows still listed count: a refetch may have dropped some.
  const selectedRows = useMemo(
    () => items.filter((row) => selected.has(keyOf(row))),
    [items, selected],
  );
  const allChecked = items.length > 0 && selectedRows.length === items.length;
  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const purge = useMutation({
    mutationFn: (rows: MissingFileRow[]) =>
      api.missingFilesPurge(bulkTargets(rows)),
    onSuccess: ({ removed }) => {
      setSelected(new Set());
      toast.success(t("missing.removedToast", { count: removed }));
    },
    onError: (e) => {
      toast.error(t("missing.removeFailed"), {
        description: e instanceof Error ? e.message : String(e),
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["missing_files"] });
      // Tags carried only by the files removed are no longer to complete.
      void qc.invalidateQueries({ queryKey: ["tags_list_all"] });
    },
  });
  const onRemove = useCallback(async () => {
    const rows = selectedRows;
    if (rows.length === 0) return;
    const ok = await confirm({
      title: t("missing.remove"),
      message: t("missing.removeConfirm", { count: rows.length }),
      confirmText: t("missing.removeAction"),
      destructive: true,
    });
    if (ok) purge.mutate(rows);
  }, [confirm, purge, selectedRows, t]);

  // One formatter for every row, rather than one per row and render.
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(lang, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [lang],
  );

  // A churning folder can leave thousands: only the rows in view are mounted.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
  }, []);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const loading = ready && missing.isLoading;
  const isSmall = modalSize === "small";
  const toggleLabel = isSmall
    ? t("media.modalMaximize")
    : t("media.modalMinimize");
  return (
    <HistoryModal onClose={onClose} size={modalSize} titleId={titleId}>
      <header className="flex items-center gap-2 border-b border-border bg-bg px-3 py-2.5">
        <FileX className="size-4 text-primary" />
        <span id={titleId} className="text-sm font-medium text-fg">
          {t("missing.title")}
        </span>
        {total > 0 && (
          <span className="text-xs tabular-nums text-muted">
            {total.toLocaleString(lang)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {items.length > 0 && (
            <Button
              variant="outline"
              size="compact"
              onClick={() => void onRemove()}
              disabled={selectedRows.length === 0 || purge.isPending}
            >
              <Trash2 />
              {t("missing.removeSelected", { count: selectedRows.length })}
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

      {missing.data?.scanning && (
        <p className="border-b border-border px-4 py-2 text-xs text-muted">
          {t("missing.scanning")}
        </p>
      )}

      {loading ? (
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center text-muted">
          <FileX className="size-10 opacity-50" />
          <p>{t("missing.empty")}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 px-4 pt-3 text-xs text-muted">
            <p>{t("missing.hint")}</p>
            {total > items.length && (
              <p>
                {t("missing.truncated", {
                  shown: items.length,
                  total,
                })}
              </p>
            )}
            <label className="flex items-center gap-3 px-1.5 py-1.5">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={allChecked}
                disabled={purge.isPending}
                onChange={() =>
                  setSelected(
                    allChecked ? new Set() : new Set(items.map(keyOf)),
                  )
                }
              />
              {t("missing.selectAll")}
            </label>
          </div>
          <ScrollArea
            className="page-scroll min-h-0 flex-1"
            viewportRef={setScrollRef}
          >
            <ul
              className="relative mx-3 mb-3"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((vr) => {
                const row = items[vr.index];
                const key = keyOf(row);
                const dir = dirOf(row.relPath);
                return (
                  <li
                    key={key}
                    className="absolute left-0 top-0 w-full"
                    style={{
                      height: ROW_HEIGHT,
                      transform: `translateY(${vr.start}px)`,
                    }}
                  >
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg p-1.5 transition hover:bg-fg/5">
                      <input
                        type="checkbox"
                        className="size-3.5 shrink-0 accent-primary"
                        checked={selected.has(key)}
                        // A removal is in flight for this selection.
                        disabled={purge.isPending}
                        onChange={() => toggle(key)}
                      />
                      <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-surface">
                        <MediaThumbnail
                          file={row}
                          mediaBase={mediaBase}
                          version={0}
                          fallbackIconSize="size-5"
                          showPlayOverlay={false}
                          scrubPreview={false}
                          showProgress={false}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-sm text-fg"
                          title={row.relPath}
                        >
                          {fileNameOf(row.relPath)}
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                          <span className="shrink-0 tabular-nums">
                            {t("missing.goneAt", {
                              date: dateFormat.format(
                                new Date(row.deletedAt * 1000),
                              ),
                            })}
                          </span>
                          {dir && (
                            <span className="truncate" title={dir}>
                              {dir}
                            </span>
                          )}
                          {showWsLabel && wsLabels.get(row.workspaceId) && (
                            <span className="shrink-0">
                              {wsLabels.get(row.workspaceId)}
                            </span>
                          )}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </>
      )}
    </HistoryModal>
  );
}
