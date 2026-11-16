// Keep a folder of a workspace out of its scans (#282), after asking: its
// files are hidden at once (not deleted), and the workspace's edit dialog
// lists the folder, to take it off again.
import { createElement, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { ExcludeFolderDetails } from "@/components/ExcludeFolderDetails";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/ipc/client";
import { invalidateHiddenFiles } from "@/lib/queryCache";

export function useExcludeFolder(): (
  workspaceId: string,
  folder: string,
  /** Files under the folder, as its card counts them. */
  count: number,
) => Promise<void> {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { t } = useI18n();
  return useCallback(
    async (workspaceId, folder, count) => {
      const name = folder.slice(folder.lastIndexOf("/") + 1);
      // Where it is on disk, not only its name: it is this folder alone, not
      // every folder of that name. Without the list, from the root down.
      // The list the app holds already, when it does.
      const root = await qc
        .ensureQueryData({
          queryKey: ["workspaces_list"],
          queryFn: api.workspacesList,
        })
        .then((l) => l.workspaces.find((w) => w.id === workspaceId)?.path)
        .catch(() => undefined);
      // The menu that asked is closed by now.
      const ok = await confirm({
        title: t("folder.excludeTitle", { name }),
        message: t("folder.excludeConfirm"),
        details: createElement(ExcludeFolderDetails, {
          root: root ?? null,
          folder,
          count,
        }),
        confirmText: t("folder.excludeAction"),
      });
      if (!ok) return;
      try {
        const next = await api.scanExclusionsAddFolder(workspaceId, folder);
        qc.setQueryData(["scan_exclusion_folders", workspaceId], next);
      } catch (e) {
        console.error("exclude folder failed:", e);
        toast.error(t("folder.excludeFailed"));
        return;
      }
      invalidateHiddenFiles(qc);
      toast.success(t("folder.excluded", { name }));
    },
    [confirm, qc, t],
  );
}
