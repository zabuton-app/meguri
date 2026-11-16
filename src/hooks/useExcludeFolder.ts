// Keep a folder of a workspace out of its scans (#282), after asking: its
// files are hidden at once (not deleted), and the workspace's edit dialog
// lists the folder, to take it off again.
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/ipc/client";
import { invalidateHiddenFiles } from "@/lib/queryCache";

export function useExcludeFolder(): (
  workspaceId: string,
  folder: string,
) => Promise<void> {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { t } = useI18n();
  return useCallback(
    async (workspaceId, folder) => {
      const name = folder.slice(folder.lastIndexOf("/") + 1);
      const ok = await confirm({
        title: t("folder.excludeFromScans"),
        // Named by its path from the workspace root, not its name: it is
        // this folder alone, not every folder of that name. The menu that
        // asked is closed by now.
        message: t("folder.excludeConfirm", { path: folder }),
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
