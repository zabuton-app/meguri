import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import type { ScanDone, WorkspacesList } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";

/** How a scan was started from this view; absent for automatic scans. */
export type ManualScanMode = "scan" | "resync" | "rebuild";

/**
 * The toasts that tell the user how a scan ended.
 *
 * Cancel and errors are user-visible outcomes, shown whether the scan was
 * started by hand or automatically (startup, workspace switch). Fixed toast
 * ids coalesce the per-workspace done events of the "All" view into one
 * toast, except the notices that name their workspace, which get one each.
 */
export function useScanNotices() {
  const qc = useQueryClient();
  const { t } = useI18n();

  // Shows a notice with the workspace's name when it is known: in the "All"
  // view any workspace can be the one. The list may not be loaded yet right
  // after launch, so it is fetched then; otherwise the cached one is used.
  const withWorkspaceName = useCallback(
    (
      workspaceId: string | undefined,
      show: (name: string | undefined) => void,
    ) => {
      void qc
        .ensureQueryData({
          queryKey: ["workspaces_list"],
          queryFn: api.workspacesList,
        })
        .then(
          (list: WorkspacesList) =>
            show(list.workspaces.find((w) => w.id === workspaceId)?.label),
          () => show(undefined),
        );
    },
    [qc],
  );

  // A workspace whose folder could not be read. The id is per workspace, so
  // the same notice from the event and from the startup query shows once.
  const notifyRootUnreadable = useCallback(
    (workspaceId: string | undefined) =>
      withWorkspaceName(workspaceId, (name) =>
        toast.error(
          name
            ? t("home.scanRootUnreadableNamed", { name })
            : t("home.scanRootUnreadable"),
          {
            id: `scan-root-unreadable:${workspaceId ?? ""}`,
            description: t("home.scanRootUnreadableDesc"),
          },
        ),
      ),
    [withWorkspaceName, t],
  );

  // Folders or files the scan could not read and left as they were (#314).
  // Shown for automatic scans too: there is no other trace of them.
  const notifySkipped = useCallback(
    (workspaceId: string | undefined, count: number) =>
      withWorkspaceName(workspaceId, (name) =>
        toast.warning(
          name
            ? t("home.scanSkippedNamed", { name, count })
            : t("home.scanSkipped", { count }),
          {
            id: `scan-skipped:${workspaceId ?? ""}`,
            description: t("home.scanSkippedDesc"),
          },
        ),
      ),
    [withWorkspaceName, t],
  );

  const notifyScanDone = useCallback(
    (done: ScanDone, mode: ManualScanMode | undefined) => {
      if (done.aborted) {
        toast.info(t("home.scanCanceled"), { id: "scan-canceled" });
        return;
      }
      if (done.errorReason === "root-unreadable") {
        notifyRootUnreadable(done.workspaceId);
        return;
      }
      if (done.error) {
        toast.error(t("home.scanError"), { id: "scan-error" });
        return;
      }
      if (done.stats.skipped > 0) {
        notifySkipped(done.workspaceId, done.stats.skipped);
      }
      // The success toast is only for manual scans (avoid noise on every auto-scan).
      if (!mode) return;
      toast.success(
        t(
          mode === "rebuild"
            ? "home.rebuildComplete"
            : mode === "resync"
              ? "home.resyncComplete"
              : "home.scanComplete",
        ),
        {
          description: t("home.scanCompleteDetail", done.stats),
        },
      );
    },
    [notifyRootUnreadable, notifySkipped, t],
  );

  return { notifyScanDone, notifyRootUnreadable };
}
