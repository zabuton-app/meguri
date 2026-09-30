// What can be done to one file or a selection of them from outside the file's
// own controls: favorite, Watch Later, rating, collection membership, and, for
// a single file, revealing it, copying its path and dropping it from the index.
//
// One hook for one file and for many: the writes go through the bulk channels
// (useBulkEdit, collection_set_membership), which take a single target as
// readily as a selection, so a toggle reads and levels the same way whether it
// was aimed at the focused card or at a hundred selected ones (see
// src/lib/bulkEdit.ts for those rules). The command menu is the first caller;
// the file context menu (#120) is meant to be the next.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import type { FileRow } from "@/ipc/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { useBulkEdit } from "@/hooks/useBulkEdit";
import type { WatchLaterMembership } from "@/hooks/useWatchLater";
import { useI18n } from "@/i18n/I18nProvider";
import {
  bulkFlagOf,
  bulkTargets,
  bulkToggleTarget,
  uniformRating,
  type BulkFlag,
} from "@/lib/bulkEdit";
import {
  forgetDeletedFile,
  invalidateCollectionSearches,
} from "@/lib/queryCache";
import { WATCH_LATER_ID } from "@shared/workspaceIds";

export interface CollectionMembership {
  id: string;
  name: string;
  emoji?: string;
  /** Whether the targets are in it: all of them, some, or none. */
  included: BulkFlag;
}

/** Actions that only make sense for one file. */
export interface SingleFileActions {
  openFolder: () => void;
  copyPath: () => void;
  /** Asks first; resolves once the file is gone from the index and the lists. */
  deleteFromIndex: () => Promise<void>;
}

export interface FileActions {
  favorite: BulkFlag;
  toggleFavorite: () => void;
  watchLater: BulkFlag;
  /** Null while the Watch Later collection's id is still loading. */
  toggleWatchLater: (() => void) | null;
  /** The rating every target shares, or null when they disagree. */
  rating: number | null;
  setRating: (rating: number) => void;
  /** Membership comes from useCollectionMembership. */
  toggleCollection: (collection: CollectionMembership) => void;
  /** Set only when there is exactly one target. */
  single: SingleFileActions | null;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The user's collections (Watch Later has its own toggle), in rail order, with
 * whether `rows` are in each. Apart from useFileActions: reading it scans
 * every collection's items, so only the view that lists the collections pays
 * for it, not every opening of a menu that merely offers them.
 */
export function useCollectionMembership(
  rows: FileRow[],
): CollectionMembership[] {
  const workspaces = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  return useMemo(() => {
    const keys = new Set(rows.map((r) => `${r.workspaceId}:${r.id}`));
    return (workspaces.data?.collections ?? [])
      .filter((c) => c.id !== WATCH_LATER_ID)
      .map((c): CollectionMembership => {
        let on = 0;
        for (const item of c.items)
          if (keys.has(`${item.workspaceId}:${item.fileId}`)) on++;
        return {
          id: c.id,
          name: c.name,
          emoji: c.emoji,
          included: on === 0 ? "none" : on >= keys.size ? "all" : "some",
        };
      });
  }, [rows, workspaces.data]);
}

export function useFileActions(
  rows: FileRow[],
  watchLater: WatchLaterMembership,
  /**
   * Skip the collection-search invalidation while the detail view is open;
   * see useBulkEdit, whose rule this is.
   */
  deferListRefresh = false,
): FileActions {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const bulk = useBulkEdit(rows, watchLater.id, deferListRefresh);

  const membership = useMutation({
    // Rows captured at click time and carried to onSuccess, for the same
    // reason as useBulkEdit's: onSuccess runs with the newest render's rows.
    mutationFn: async ({
      collection,
      add,
    }: {
      collection: CollectionMembership;
      add: boolean;
    }) => {
      const written = rows;
      const result = await api.collectionSetMembership(
        collection.id,
        bulkTargets(written),
        add ? "add" : "remove",
      );
      return { changed: result.changed, written };
    },
    onSuccess: ({ changed, written }, { collection, add }) => {
      void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
      if (!deferListRefresh) invalidateCollectionSearches(qc);
      const name = collection.name;
      if (written.length === 1) {
        toast.success(
          add
            ? t("collection.addedToast", { name })
            : t("collection.removedFromToast", { name }),
        );
      } else {
        toast.success(
          add
            ? t("collection.addedCountToast", { count: changed, name })
            : t("collection.removedCountToast", { count: changed, name }),
        );
      }
    },
    onError: (e) =>
      toast.error(t("collection.actionFailed"), { description: errorText(e) }),
  });

  const favorite = bulkFlagOf(rows, (row) => !!row.favorite).flag;
  const queued = bulkFlagOf(rows, (row) =>
    watchLater.has(row.workspaceId, row.id),
  ).flag;

  const file = rows.length === 1 ? rows[0] : null;
  const single = useMemo<SingleFileActions | null>(() => {
    if (!file) return null;
    const { id, workspaceId } = file;
    return {
      openFolder: () => {
        api
          .openFolder(id, workspaceId)
          .catch((e: unknown) =>
            toast.error(t("folder.openFailed"), { description: errorText(e) }),
          );
      },
      copyPath: () => {
        api.copyFilePath(id, workspaceId).then(
          () => toast.success(t("media.filePathCopied"), { id: "path-copied" }),
          (e: unknown) =>
            toast.error(t("folder.copyFailed"), { description: errorText(e) }),
        );
      },
      // The detail view's delete (useDetailMutations) without a view to
      // close afterwards.
      deleteFromIndex: async () => {
        const ok = await confirm({
          title: t("media.deleteFromIndex"),
          message: t("media.deleteFromIndexConfirm"),
          confirmText: t("media.deleteFromIndex"),
          destructive: true,
        });
        if (!ok) return;
        try {
          const deleted = await api.fileDeleteFromIndex(id, workspaceId);
          forgetDeletedFile(qc, workspaceId, deleted.id);
        } catch (e) {
          toast.error(t("media.deleteFromIndexFailed"), {
            description: errorText(e),
          });
        }
      },
    };
  }, [file, t, confirm, qc]);

  return {
    favorite,
    toggleFavorite: () => bulk.setFavorite(bulkToggleTarget(favorite)),
    watchLater: queued,
    toggleWatchLater: watchLater.id
      ? () => bulk.setWatchLater(bulkToggleTarget(queued))
      : null,
    rating: uniformRating(rows),
    setRating: bulk.setRating,
    toggleCollection: (collection) =>
      membership.mutate({
        collection,
        add: bulkToggleTarget(collection.included),
      }),
    single,
  };
}
