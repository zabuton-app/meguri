// Duplicate file browser. /duplicates. Lists groups of files sharing the same
// (content_hash, size) pair, scoped like history: the active workspace, or all
// workspaces when All / a collection is active. Two panes: the group list on
// the left, the selected group's copies compared on the right. Read-only —
// resolving duplicates (deleting copies) is out of scope. Overlays the list
// as a modal.
import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CopyCheck, Maximize2, Minimize2, X } from "lucide-react";
import { MAX_DUPLICATE_GROUPS } from "@shared/duplicates";
import { api } from "@/ipc/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { ModalSize } from "@/routes/MediaDetail/MediaModal";
import { HistoryModal } from "@/routes/History/HistoryModal";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/I18nProvider";
import { GroupDetail } from "./GroupDetail";
import { GroupList } from "./GroupList";
import {
  groupKey,
  reclaimableBytes,
  visibleGroups,
  type DuplicateKindFilter,
  type DuplicateSort,
} from "./groupView";

const MODAL_SIZE_KEY = "meguri.duplicates.modalSize";

function SummaryChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full bg-surface px-2.5 py-0.5 text-xs text-fg tabular-nums">
      {children}
    </span>
  );
}

export default function Duplicates() {
  const { t } = useI18n();
  const titleId = useId();
  const navigate = useNavigate();
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
    // The list always contains the virtual "All" entry, so > 2 means
    // multiple real roots; with one root the label says nothing.
    return map.size > 2 ? map : null;
  }, [wsList.data]);

  const duplicates = useQuery({
    queryKey: ["duplicates_list", wsId],
    queryFn: api.duplicatesList,
    enabled: ready,
  });
  const groups = useMemo(
    () => duplicates.data?.groups ?? [],
    [duplicates.data],
  );
  const totalReclaimable = useMemo(
    () => groups.reduce((sum, g) => sum + reclaimableBytes(g), 0),
    [groups],
  );
  const maxReclaimable = useMemo(
    () => groups.reduce((max, g) => Math.max(max, reclaimableBytes(g)), 0),
    [groups],
  );

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<DuplicateKindFilter>("all");
  const [sort, setSort] = useState<DuplicateSort>("reclaimable");
  const visible = useMemo(
    () => visibleGroups(groups, { query, kind, sort }),
    [groups, query, kind, sort],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // A selection the filter hid (or that is gone after a rescan) falls back to
  // the first visible group, so the detail pane always matches the list. The
  // fallback becomes the selection: clearing the filter later must not jump
  // back to a group the user no longer sees as selected.
  const selected =
    visible.find((g) => groupKey(g) === selectedKey) ?? visible[0] ?? null;
  const shownKey = selected ? groupKey(selected) : null;
  if (shownKey && shownKey !== selectedKey) setSelectedKey(shownKey);

  const loading = ready && duplicates.isLoading;

  const isSmall = modalSize === "small";
  const toggleLabel = isSmall
    ? t("media.modalMaximize")
    : t("media.modalMinimize");
  return (
    <HistoryModal onClose={onClose} size={modalSize} titleId={titleId}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-bg px-3 py-2.5">
        <CopyCheck className="size-4 text-primary" />
        <h1 id={titleId} className="text-sm font-medium text-fg">
          {t("duplicates.title")}
        </h1>
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-1.5 sm:ml-2">
            <SummaryChip>
              <strong className="text-sm font-semibold text-warn">
                {formatSize(totalReclaimable, "0 B")}
              </strong>
              <span className="text-muted">{t("duplicates.reclaimable")}</span>
            </SummaryChip>
            <SummaryChip>
              {t("duplicates.groupCount", { count: groups.length })}
            </SummaryChip>
            <SummaryChip>
              {t("duplicates.fileCount", {
                count: duplicates.data?.fileCount ?? 0,
              })}
            </SummaryChip>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={toggleModalSize}
            aria-label={toggleLabel}
            aria-pressed={isSmall}
            title={toggleLabel}
          >
            {isSmall ? <Maximize2 /> : <Minimize2 />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onClose}
            aria-label={t("common.close")}
            title={`${t("common.close")} (Esc)`}
          >
            <X />
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : duplicates.isError && !duplicates.data ? (
        <div
          role="alert"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center text-muted"
        >
          <p>{t("duplicates.loadFailed")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void duplicates.refetch()}
            disabled={duplicates.isFetching}
          >
            {t("duplicates.retry")}
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center text-muted">
          <CopyCheck className="size-10 opacity-50" />
          <p>{t("duplicates.empty")}</p>
          <p className="text-xs">{t("duplicates.emptyHint")}</p>
        </div>
      ) : (
        <>
          {duplicates.data?.truncated && (
            <p className="border-b border-border px-4 py-1.5 text-xs text-muted">
              {t("duplicates.truncated", { max: MAX_DUPLICATE_GROUPS })}
            </p>
          )}
          {/* Side by side from md up; below that the panes stack, so a narrow
              window does not squeeze the copy cards next to a fixed-width list. */}
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <GroupList
              className={cn(
                "max-h-[45%] shrink-0 border-b md:max-h-none md:border-r md:border-b-0",
                isSmall ? "md:w-72" : "md:w-96",
              )}
              groups={visible}
              selectedKey={shownKey}
              onSelect={setSelectedKey}
              maxReclaimable={maxReclaimable}
              query={query}
              onQueryChange={setQuery}
              kind={kind}
              onKindChange={setKind}
              sort={sort}
              onSortChange={setSort}
              mediaBase={mediaBase}
            />
            {selected && (
              <GroupDetail
                key={groupKey(selected)}
                className="min-w-0 flex-1"
                group={selected}
                mediaBase={mediaBase}
                wsLabels={wsLabels}
              />
            )}
          </div>
        </>
      )}
    </HistoryModal>
  );
}
