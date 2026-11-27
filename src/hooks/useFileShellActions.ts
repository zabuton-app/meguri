// Opening a file externally, revealing it in its folder and copying its path:
// the three actions that hand a file to the OS. Every place that offers them
// (the context and command menus through useFileActions, the detail view, a
// Discover card, the video error panel, Duplicates) calls these, so they all
// give the same feedback: a toast on failure, and one on a copied path.
//
// Stopping whatever is playing the file here before it opens externally stays
// with the caller, which knows what that is.
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import {
  dropFromWatchLaterCache,
  invalidatePlayedSearches,
} from "@/lib/queryCache";

export interface FileShellActions {
  openExternal: (id: number, workspaceId: string) => void;
  openFolder: (id: number, workspaceId: string) => void;
  copyPath: (id: number, workspaceId: string) => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useFileShellActions(): FileShellActions {
  const { t } = useI18n();
  const qc = useQueryClient();
  return useMemo(
    () => ({
      openExternal: (id, workspaceId) => {
        // The main process records the play and consumes the Watch Later
        // entry; mirror that once it confirms. It can also refuse (a file
        // gone missing under the root), and patching regardless would show
        // the file as consumed when it is not.
        api.openExternal(id, workspaceId).then(
          () => {
            dropFromWatchLaterCache(qc, workspaceId, id);
            invalidatePlayedSearches(qc);
          },
          (e: unknown) =>
            toast.error(t("media.openExternalFailed"), {
              description: errorText(e),
            }),
        );
      },
      openFolder: (id, workspaceId) => {
        api
          .openFolder(id, workspaceId)
          .catch((e: unknown) =>
            toast.error(t("folder.openFailed"), { description: errorText(e) }),
          );
      },
      copyPath: (id, workspaceId) => {
        api.copyFilePath(id, workspaceId).then(
          () => toast.success(t("media.filePathCopied"), { id: "path-copied" }),
          (e: unknown) =>
            toast.error(t("folder.copyFailed"), { description: errorText(e) }),
        );
      },
    }),
    [t, qc],
  );
}
