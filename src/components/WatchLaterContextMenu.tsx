// Right-click menu on media list entries offering the built-in Watch Later toggle.
// Wraps an entry (grid card, list row, table row) so every view gets the same action.
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, CircleMinus } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { api } from "@/ipc/client";
import { invalidateCollectionSearches } from "@/lib/queryCache";
import { useI18n } from "@/i18n/I18nProvider";
import { WATCH_LATER_ID } from "@shared/workspaceIds";
import type { FileRow } from "@/ipc/types";

export function WatchLaterContextMenu({
  file,
  children,
}: {
  file: FileRow;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const workspaces = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  const watchLater =
    workspaces.data?.collections.find((c) => c.id === WATCH_LATER_ID) ?? null;
  const included =
    watchLater?.items.some(
      (item) =>
        item.workspaceId === file.workspaceId && item.fileId === file.id,
    ) ?? false;

  const onSettled = () => {
    void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
    // Membership changes only affect collection-scoped lists, not workspace lists.
    invalidateCollectionSearches(qc);
  };
  const onError = (error: unknown) => {
    toast.error(t("watchLater.actionFailed"), {
      description: error instanceof Error ? error.message : String(error),
    });
  };

  const add = useMutation({
    mutationFn: (collectionId: string) =>
      api.collectionAddFile(collectionId, file.id, file.workspaceId),
    onSuccess: () => {
      onSettled();
      toast.success(t("watchLater.addedToast"));
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (collectionId: string) =>
      api.collectionRemoveFile(collectionId, file.id, file.workspaceId),
    onSuccess: () => {
      onSettled();
      toast.success(t("watchLater.removedToast"));
    },
    onError,
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!watchLater}
          onSelect={() => {
            if (!watchLater) return;
            if (included) remove.mutate(watchLater.id);
            else add.mutate(watchLater.id);
          }}
        >
          {included ? <CircleMinus /> : <Clock />}
          {included ? t("watchLater.remove") : t("watchLater.add")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
