// Duplicate file browser. /duplicates. Lists groups of files sharing the same
// (content_hash, size) pair, scoped like history: the active workspace, or all
// workspaces when All / a collection is active. Read-only — resolving
// duplicates (deleting copies) is out of scope. Overlays the list as a modal.
import { useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CopyCheck, Maximize2, Minimize2, X } from "lucide-react";
import { MAX_DUPLICATE_GROUPS } from "@shared/duplicates";
import { api } from "@/ipc/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { ModalSize } from "@/routes/MediaDetail/MediaModal";
import { HistoryModal } from "@/routes/History/HistoryModal";
import { fileHref } from "@/lib/fileHref";
import { formatSize } from "@/lib/format";
import type { DuplicateGroup } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { useI18n } from "@/i18n/I18nProvider";

const MODAL_SIZE_KEY = "meguri.duplicates.modalSize";

function wastedBytes(group: DuplicateGroup): number {
  return group.size * (group.files.length - 1);
}

export default function Duplicates() {
  const { t } = useI18n();
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
    return map;
  }, [wsList.data]);
  // The list always contains the virtual "All" entry, so > 2 means multiple real roots.
  const showWsLabel = wsLabels.size > 2;

  const duplicates = useQuery({
    queryKey: ["duplicates_list", wsId],
    queryFn: api.duplicatesList,
    enabled: ready,
  });
  const groups = duplicates.data?.groups ?? [];
  const totalWasted = useMemo(
    () => groups.reduce((sum, g) => sum + wastedBytes(g), 0),
    [groups],
  );

  const loading = ready && duplicates.isLoading;

  const isSmall = modalSize === "small";
  const toggleLabel = isSmall
    ? t("media.modalMaximize")
    : t("media.modalMinimize");
  return (
    <HistoryModal onClose={onClose} size={modalSize}>
      <header className="flex items-center gap-2 border-b border-border bg-bg px-3 py-2.5">
        <CopyCheck className="size-4 text-primary" />
        <span className="text-sm font-medium text-fg">
          {t("duplicates.title")}
        </span>
        {groups.length > 0 && (
          <span className="text-xs text-muted">
            {t("duplicates.summary", {
              groups: groups.length,
              files: duplicates.data?.fileCount ?? 0,
              size: formatSize(totalWasted, "0 B"),
            })}
          </span>
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
            <CopyCheck className="size-10 opacity-50" />
            <p>{t("duplicates.empty")}</p>
            <p className="text-xs">{t("duplicates.emptyHint")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            {duplicates.data?.truncated && (
              <p className="px-1 text-xs text-muted">
                {t("duplicates.truncated", { max: MAX_DUPLICATE_GROUPS })}
              </p>
            )}
            {groups.map((g) => (
              <section key={`${g.contentHash}:${g.size}`}>
                <h3 className="sticky top-0 z-10 flex items-baseline gap-2 bg-bg px-1 py-1.5 text-xs font-semibold text-muted">
                  <span className="tabular-nums text-fg">
                    {formatSize(g.size, "0 B")}
                  </span>
                  <span>
                    {t("duplicates.fileCount", { count: g.files.length })}
                  </span>
                  <span className="font-mono font-normal opacity-60">
                    {g.contentHash.slice(0, 8)}
                  </span>
                </h3>
                <ul className="flex flex-col gap-1">
                  {g.files.map((file) => (
                    <li key={`${file.workspaceId}:${file.id}`}>
                      <Link
                        to={fileHref(file.id, file.workspaceId, {
                          autoplay: false,
                        })}
                        className="group/thumb flex items-center gap-3 rounded-lg p-1.5 transition hover:bg-fg/5"
                      >
                        <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-surface">
                          <MediaThumbnail
                            file={file}
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
                            title={file.relPath}
                          >
                            {file.relPath}
                          </span>
                          {showWsLabel && wsLabels.get(file.workspaceId) && (
                            <span className="mt-0.5 block truncate text-xs text-muted">
                              {wsLabels.get(file.workspaceId)}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </HistoryModal>
  );
}
