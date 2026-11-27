// Opening a workspace folder in the file manager and copying its path, with
// their toasts. The folder view's header acts on the folder being browsed,
// the folder card's right-click menu on that card's folder.
import { useMemo } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/ipc/client";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface FolderPathActions {
  openInFileManager: (workspaceId: string, path: string) => void;
  copyPath: (workspaceId: string, path: string) => void;
}

export function useFolderPathActions(): FolderPathActions {
  const { t } = useI18n();
  return useMemo(
    () => ({
      openInFileManager: (workspaceId, path) => {
        api.folderOpenInFileManager(workspaceId, path).catch((e: unknown) =>
          toast.error(t("folder.openFailed"), {
            id: "folder-open-failed",
            description: errorText(e),
          }),
        );
      },
      copyPath: (workspaceId, path) => {
        api.folderCopyPath(workspaceId, path).then(
          () =>
            toast.success(t("folder.pathCopied"), { id: "folder-path-copied" }),
          (e: unknown) =>
            toast.error(t("folder.copyFailed"), {
              id: "folder-copy-failed",
              description: errorText(e),
            }),
        );
      },
    }),
    [t],
  );
}
