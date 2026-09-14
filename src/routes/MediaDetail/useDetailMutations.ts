import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import log from "@/lib/logger";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  LIST_HIDDEN_SOURCES,
  RESERVED_TAG_ERROR,
  reservedTagPrefix,
} from "@shared/tags";
import { api } from "@/ipc/client";
import type { FileDetail } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import {
  dropFromWatchLaterCache,
  invalidateCollectionSearches,
  invalidateTagSearches,
  patchFileRowInCaches,
  removeFileRowFromCaches,
  syncFileRowAcrossCaches,
} from "@/lib/queryCache";

export interface CollectionRef {
  id: string;
  name: string;
}

/** What the detail view can do to its file; see useDetailMutations. */
export interface DetailActions {
  setRating: (rating: number) => void;
  addTag: (name: string) => void;
  removeTag: (tagId: number) => void;
  addToCollection: (c: CollectionRef) => void;
  removeFromCollection: (c: CollectionRef) => void;
  addBookmark: (sec: number) => void;
  removeBookmark: (bookmarkId: number) => void;
  /** `null` reverts to the auto-extracted frame. */
  setMainThumb: (sec: number | null) => void;
  exportFrame: (sec: number) => void;
  /** Asks first; resolves once the file is gone and the view has been told. */
  deleteFromIndex: () => Promise<void>;
  openExternal: () => void;
  pending: {
    bookmark: boolean;
    export: boolean;
    /**
     * The scene being applied as the main thumbnail (`null` = reverting to
     * the auto frame), or undefined while none is. Only that scene should
     * look busy; greying out the whole row read as the page freezing.
     */
    thumbSec: number | null | undefined;
  };
}

/**
 * Everything the detail view does *to* the file, with the cache upkeep each
 * one needs: rating, tags, bookmarks, the main thumbnail, frame export,
 * collection membership, removal from the index, and opening the file in an
 * external player. The mutations patch the react-query caches in place
 * wherever they can, so the list behind the detail view stays in step without
 * refetching every page of every list.
 *
 * Returns plain actions and flags rather than react-query's mutation objects,
 * so the route composes buttons without knowing how the writes are run.
 */
export function useDetailMutations({
  fileId,
  wsId,
  onIndexEntryRemoved,
  onDeleteFinished,
  pauseVideo,
  pauseAudio,
}: {
  fileId: number;
  wsId: string;
  /** The main process has dropped the file; the list caches are not yet patched. */
  onIndexEntryRemoved?: () => void;
  /** The file is gone from the index and every cache: time to close the view. */
  onDeleteFinished?: () => void;
  /** Pause this view's video before an external player takes the file. */
  pauseVideo?: () => void;
  /** Pause the bar's track before an external player takes the file. */
  pauseAudio?: () => void;
}): DetailActions {
  const { t } = useI18n();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const detailKey = ["file_get", wsId, fileId] as const;

  const setRating = useMutation({
    mutationFn: (r: number) => api.fileSetRating(fileId, wsId, r),
    onSuccess: (_d, r) => {
      syncFileRowAcrossCaches(qc, wsId, fileId, { rating: r });
    },
  });

  // After a tag edit, refetch the canonical detail (tag names are normalized
  // server-side) and mirror its tags into the list caches, instead of
  // refetching every page of every list. Only searches whose membership
  // depends on tags (tag filter / text query) are invalidated.
  const onTagsChanged = async () => {
    try {
      const fresh = await qc.fetchQuery({
        queryKey: detailKey,
        queryFn: () => api.fileGet(fileId, wsId),
      });
      if (fresh) {
        // FileRow omits pipeline sources (see attachTags); patching straight from
        // the detail response would put them back into the list caches.
        patchFileRowInCaches(qc, wsId, fileId, {
          tags: fresh.tags.filter(
            (tag) => !LIST_HIDDEN_SOURCES.includes(tag.source),
          ),
        });
      }
    } catch {
      // The tag edit itself succeeded; if the refetch fails (transient IPC
      // error), fall back to invalidating the detail so it reloads lazily.
      void qc.invalidateQueries({ queryKey: detailKey });
    }
    invalidateTagSearches(qc);
    void qc.invalidateQueries({ queryKey: ["tags_list_all"] });
  };
  const addTag = useMutation({
    mutationFn: (name: string) => api.fileAddTag(fileId, wsId, name),
    onSuccess: onTagsChanged,
    onError: (error, name) => {
      // main rejects a name that impersonates a pipeline-owned namespace; any
      // other failure (DB error, unknown workspace) deserves its own message.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(RESERVED_TAG_ERROR)) {
        toast.error(
          t("tags.addFailedReserved", {
            prefix: reservedTagPrefix(name) ?? name,
          }),
        );
      } else {
        toast.error(t("tag.addFailed"), { description: message });
      }
    },
  });
  const removeTag = useMutation({
    mutationFn: (tagId: number) => api.fileRemoveTag(fileId, wsId, tagId),
    onSuccess: onTagsChanged,
  });

  const deleteFromIndexMutation = useMutation({
    mutationFn: () => api.fileDeleteFromIndex(fileId, wsId),
    onSuccess: onIndexEntryRemoved,
  });
  /**
   * Ask, then drop the file from the index and from every list cache it
   * appears in, then hand back to the caller (which closes the view).
   */
  const deleteFromIndex = async () => {
    const ok = await confirm({
      title: t("media.deleteFromIndex"),
      message: t("media.deleteFromIndexConfirm"),
      confirmText: t("media.deleteFromIndex"),
      destructive: true,
    });
    if (!ok) return;
    const deleted = await deleteFromIndexMutation.mutateAsync();
    removeFileRowFromCaches(qc, wsId, deleted.id);
    qc.removeQueries({ queryKey: ["file_get", wsId, deleted.id] });
    void qc.invalidateQueries({ queryKey: ["files_search"] });
    void qc.invalidateQueries({ queryKey: ["files_random"] });
    onDeleteFinished?.();
  };

  const openExternal = () => {
    // The external player is about to play this very file: stop it here.
    pauseVideo?.();
    pauseAudio?.();
    // The main process records the play and consumes the Watch Later entry,
    // so mirror that once it confirms — it can also refuse (a file gone
    // missing under the root), and patching regardless would show the file
    // as consumed when it is not.
    void api
      .openExternal(fileId, wsId)
      .then(() => dropFromWatchLaterCache(qc, wsId, fileId))
      .catch((e: unknown) => log.error("open external", e));
  };

  const invalidateCollections = () => {
    void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
    // Membership changes only affect collection-scoped lists, not workspace lists.
    invalidateCollectionSearches(qc);
  };
  const onCollectionError = (error: unknown) => {
    toast.error(t("collection.actionFailed"), {
      description: error instanceof Error ? error.message : String(error),
    });
  };
  const addToCollection = useMutation({
    mutationFn: (c: CollectionRef) => api.collectionAddFile(c.id, fileId, wsId),
    onSuccess: (_data, c) => {
      invalidateCollections();
      toast.success(t("collection.addedToast", { name: c.name }));
    },
    onError: onCollectionError,
  });
  const removeFromCollection = useMutation({
    mutationFn: (c: CollectionRef) =>
      api.collectionRemoveFile(c.id, fileId, wsId),
    onSuccess: (_data, c) => {
      invalidateCollections();
      toast.success(t("collection.removedFromToast", { name: c.name }));
    },
    onError: onCollectionError,
  });

  const addBookmark = useMutation({
    mutationFn: (sec: number) => api.bookmarkAdd(fileId, wsId, sec),
    onSuccess: (created) => {
      if (!created) return;
      qc.setQueryData<FileDetail | null>(detailKey, (old) =>
        old
          ? {
              ...old,
              bookmarks: [
                ...old.bookmarks.filter((b) => b.id !== created.id),
                created,
              ].sort((a, b) => a.sec - b.sec || a.id - b.id),
            }
          : old,
      );
    },
  });
  const removeBookmark = useMutation({
    mutationFn: (bookmarkId: number) =>
      api.bookmarkRemove(fileId, wsId, bookmarkId),
    onSuccess: (_void, bookmarkId) => {
      qc.setQueryData<FileDetail | null>(detailKey, (old) =>
        old
          ? {
              ...old,
              bookmarks: old.bookmarks.filter((b) => b.id !== bookmarkId),
            }
          : old,
      );
    },
  });

  const setMainThumb = useMutation({
    // `sec=null` reverts to the auto-extracted frame.
    mutationFn: (sec: number | null) => api.thumbSetOffset(fileId, wsId, sec),
    // Snap the highlighted star to the chosen scene immediately; if ffmpeg fails the
    // backend throws and we roll back so the UI doesn't lie about the saved offset.
    onMutate: async (sec) => {
      await qc.cancelQueries({ queryKey: detailKey });
      const prev = qc.getQueryData<FileDetail | null>(detailKey);
      qc.setQueryData<FileDetail | null>(detailKey, (old) =>
        old ? { ...old, thumbOffsetSec: sec } : old,
      );
      return { prev };
    },
    onError: (_err, _sec, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData(detailKey, ctx.prev);
      }
    },
    onSuccess: (res) => {
      // Reconcile to the server-confirmed value (in case clamping happened).
      // List/grid thumbnails refresh via the `thumb:done` event from the main process —
      // no manual cache surgery needed for ["files_search"]/["files_random"].
      qc.setQueryData<FileDetail | null>(detailKey, (old) =>
        old ? { ...old, thumbOffsetSec: res.thumbOffsetSec } : old,
      );
    },
  });

  const exportFrame = useMutation({
    mutationFn: (sec: number) => api.frameExport(fileId, wsId, sec),
    onSuccess: (res) => {
      // A canceled save dialog resolves with saved=false — stay silent.
      if (res.saved) toast.success(t("player.frameExported"));
    },
    onError: () => toast.error(t("player.frameExportFailed")),
  });

  // Single-argument wrappers, not the mutate functions themselves: mutate
  // takes options as a second argument, and a DOM handler wired straight to
  // it would pass the event there.
  return {
    setRating: (rating) => setRating.mutate(rating),
    addTag: (name) => addTag.mutate(name),
    removeTag: (tagId) => removeTag.mutate(tagId),
    addToCollection: (c) => addToCollection.mutate(c),
    removeFromCollection: (c) => removeFromCollection.mutate(c),
    addBookmark: (sec) => addBookmark.mutate(sec),
    removeBookmark: (bookmarkId) => removeBookmark.mutate(bookmarkId),
    setMainThumb: (sec) => setMainThumb.mutate(sec),
    exportFrame: (sec) => exportFrame.mutate(sec),
    deleteFromIndex,
    openExternal,
    pending: {
      bookmark: addBookmark.isPending || removeBookmark.isPending,
      export: exportFrame.isPending,
      thumbSec: setMainThumb.isPending
        ? (setMainThumb.variables ?? null)
        : undefined,
    },
  };
}
