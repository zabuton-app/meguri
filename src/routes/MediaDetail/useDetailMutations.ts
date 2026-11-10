import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import log from "@/lib/logger";
import { useConfirm } from "@/components/ConfirmDialog";
import { useForgetSelected } from "@/components/SelectionContext";
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
  forgetDeletedFile,
  invalidatePlayedSearches,
  invalidateCollectionSearches,
  invalidateTagSearches,
  patchFileRowInCaches,
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
    mainThumb: boolean;
  };
  /**
   * The scene being applied as the main thumbnail (`null` = reverting to the
   * auto frame), or undefined while none is — the shape the scene pickers
   * take. Only that scene should look busy; greying out the whole row read as
   * the page freezing.
   */
  pendingThumbSec: number | null | undefined;
}

/** The file an action acts on (file ids are unique only within a workspace). */
export interface Target {
  fileId: number;
  wsId: string;
}

function sameTarget(a: Target, b: Target): boolean {
  return a.fileId === b.fileId && a.wsId === b.wsId;
}

function detailKeyOf(target: Target) {
  return ["file_get", target.wsId, target.fileId] as const;
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
  fileName,
  onIndexEntryRemoved,
  onDeleteFinished,
  pauseVideo,
  pauseAudio,
}: {
  fileId: number;
  wsId: string;
  /** Named in the delete confirmation, once the detail has loaded. */
  fileName?: string;
  /** The main process has dropped this file (the one shown when the delete
   *  started); the list caches are not yet patched. */
  onIndexEntryRemoved?: (removed: Target) => void;
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
  const forgetSelected = useForgetSelected();
  // Every mutation takes the file it acts on as a variable, set when the
  // action starts. The route keeps this hook mounted across prev/next, and
  // react-query runs a mutation with the options of the latest render: a file
  // read from the closure would be the one shown when it runs or settles, not
  // the one the action was started on (#258).
  const here: Target = { fileId, wsId };
  // The file shown now, for what only makes sense while it still is.
  const shownNow = useRef(here);
  useEffect(() => {
    shownNow.current = { fileId, wsId };
  }, [fileId, wsId]);

  const setRating = useMutation({
    mutationFn: ({ target, rating }: { target: Target; rating: number }) =>
      api.fileSetRating(target.fileId, target.wsId, rating),
    onSuccess: (_d, { target, rating }) => {
      syncFileRowAcrossCaches(qc, target.wsId, target.fileId, { rating });
    },
  });

  // After a tag edit, refetch the canonical detail (tag names are normalized
  // server-side) and mirror its tags into the list caches, instead of
  // refetching every page of every list. Only searches whose membership
  // depends on tags (tag filter / text query) are invalidated.
  const onTagsChanged = async (target: Target) => {
    const key = detailKeyOf(target);
    try {
      const fresh = await qc.fetchQuery({
        queryKey: key,
        queryFn: () => api.fileGet(target.fileId, target.wsId),
      });
      if (fresh) {
        // FileRow omits pipeline sources (see attachTags); patching straight from
        // the detail response would put them back into the list caches.
        patchFileRowInCaches(qc, target.wsId, target.fileId, {
          tags: fresh.tags.filter(
            (tag) => !LIST_HIDDEN_SOURCES.includes(tag.source),
          ),
        });
      }
    } catch {
      // The tag edit itself succeeded; if the refetch fails (transient IPC
      // error), fall back to invalidating the detail so it reloads lazily.
      void qc.invalidateQueries({ queryKey: key });
    }
    invalidateTagSearches(qc);
    void qc.invalidateQueries({ queryKey: ["tags_list_all"] });
  };
  const addTag = useMutation({
    mutationFn: ({ target, name }: { target: Target; name: string }) =>
      api.fileAddTag(target.fileId, target.wsId, name),
    onSuccess: (_d, { target }) => onTagsChanged(target),
    onError: (error, { name }) => {
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
    mutationFn: ({ target, tagId }: { target: Target; tagId: number }) =>
      api.fileRemoveTag(target.fileId, target.wsId, tagId),
    onSuccess: (_d, { target }) => onTagsChanged(target),
  });

  const deleteFromIndexMutation = useMutation({
    mutationFn: (target: Target) =>
      api.fileDeleteFromIndex(target.fileId, target.wsId),
  });
  /**
   * Ask, then drop the file from the index and from every list cache it
   * appears in, then hand back to the caller (which closes the view). The
   * file is the one shown when this was called, even if the view moved on
   * while the dialog was open; the view is only closed if it still shows it.
   */
  const deleteFromIndex = async () => {
    const target = here;
    const ok = await confirm({
      title: t("media.deleteFromIndex"),
      // Named, so the file being removed is clear even if the view moves on
      // behind the dialog.
      message: fileName
        ? t("media.deleteFileFromIndexConfirm", { name: fileName })
        : t("media.deleteFromIndexConfirm"),
      confirmText: t("media.deleteFromIndex"),
      destructive: true,
    });
    if (!ok) return;
    const deleted = await deleteFromIndexMutation.mutateAsync(target);
    onIndexEntryRemoved?.(target);
    forgetDeletedFile(qc, target.wsId, deleted.id);
    // A selected row outlives the list's copy of it (see forget).
    forgetSelected({ id: deleted.id, workspaceId: target.wsId });
    if (sameTarget(shownNow.current, target)) onDeleteFinished?.();
  };

  const openExternal = () => {
    const target = here;
    // The external player is about to play this very file: stop it here.
    pauseVideo?.();
    pauseAudio?.();
    // The main process records the play and consumes the Watch Later entry,
    // so mirror that once it confirms — it can also refuse (a file gone
    // missing under the root), and patching regardless would show the file
    // as consumed when it is not.
    void api
      .openExternal(target.fileId, target.wsId)
      .then(() => {
        dropFromWatchLaterCache(qc, target.wsId, target.fileId);
        invalidatePlayedSearches(qc);
      })
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
    mutationFn: ({ target, c }: { target: Target; c: CollectionRef }) =>
      api.collectionAddFile(c.id, target.fileId, target.wsId),
    onSuccess: (_data, { c }) => {
      invalidateCollections();
      toast.success(t("collection.addedToast", { name: c.name }));
    },
    onError: onCollectionError,
  });
  const removeFromCollection = useMutation({
    mutationFn: ({ target, c }: { target: Target; c: CollectionRef }) =>
      api.collectionRemoveFile(c.id, target.fileId, target.wsId),
    onSuccess: (_data, { c }) => {
      invalidateCollections();
      toast.success(t("collection.removedFromToast", { name: c.name }));
    },
    onError: onCollectionError,
  });

  const addBookmark = useMutation({
    mutationFn: ({ target, sec }: { target: Target; sec: number }) =>
      api.bookmarkAdd(target.fileId, target.wsId, sec),
    onSuccess: (created, { target }) => {
      if (!created) return;
      qc.setQueryData<FileDetail | null>(detailKeyOf(target), (old) =>
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
    mutationFn: ({
      target,
      bookmarkId,
    }: {
      target: Target;
      bookmarkId: number;
    }) => api.bookmarkRemove(target.fileId, target.wsId, bookmarkId),
    onSuccess: (_void, { target, bookmarkId }) => {
      qc.setQueryData<FileDetail | null>(detailKeyOf(target), (old) =>
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
    mutationFn: ({ target, sec }: { target: Target; sec: number | null }) =>
      api.thumbSetOffset(target.fileId, target.wsId, sec),
    // Snap the highlighted star to the chosen scene immediately; if ffmpeg fails the
    // backend throws and we roll back so the UI doesn't lie about the saved offset.
    onMutate: async ({ target, sec }) => {
      const key = detailKeyOf(target);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<FileDetail | null>(key);
      qc.setQueryData<FileDetail | null>(key, (old) =>
        old ? { ...old, thumbOffsetSec: sec } : old,
      );
      return { prev };
    },
    onError: (_err, { target }, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData(detailKeyOf(target), ctx.prev);
      }
    },
    onSuccess: (res, { target }) => {
      // Reconcile to the server-confirmed value (in case clamping happened).
      // List/grid thumbnails refresh via the `thumb:done` event from the main process —
      // no manual cache surgery needed for ["files_search"]/["files_random"].
      qc.setQueryData<FileDetail | null>(detailKeyOf(target), (old) =>
        old ? { ...old, thumbOffsetSec: res.thumbOffsetSec } : old,
      );
    },
  });

  const exportFrame = useMutation({
    mutationFn: ({ target, sec }: { target: Target; sec: number }) =>
      api.frameExport(target.fileId, target.wsId, sec),
    onSuccess: (res) => {
      // A canceled save dialog resolves with saved=false — stay silent.
      if (res.saved) toast.success(t("player.frameExported"));
    },
    onError: () => toast.error(t("player.frameExportFailed")),
  });

  // Busy flags only for a mutation running on the file shown now.
  const busyHere = (m: {
    isPending: boolean;
    variables?: { target: Target };
  }) =>
    m.isPending &&
    m.variables !== undefined &&
    sameTarget(m.variables.target, here);

  // Single-argument wrappers, not the mutate functions themselves: mutate
  // takes options as a second argument, and a DOM handler wired straight to
  // it would pass the event there.
  return {
    setRating: (rating) => setRating.mutate({ target: here, rating }),
    addTag: (name) => addTag.mutate({ target: here, name }),
    removeTag: (tagId) => removeTag.mutate({ target: here, tagId }),
    addToCollection: (c) => addToCollection.mutate({ target: here, c }),
    removeFromCollection: (c) =>
      removeFromCollection.mutate({ target: here, c }),
    addBookmark: (sec) => addBookmark.mutate({ target: here, sec }),
    removeBookmark: (bookmarkId) =>
      removeBookmark.mutate({ target: here, bookmarkId }),
    setMainThumb: (sec) => setMainThumb.mutate({ target: here, sec }),
    exportFrame: (sec) => exportFrame.mutate({ target: here, sec }),
    deleteFromIndex,
    openExternal,
    pending: {
      bookmark: busyHere(addBookmark) || busyHere(removeBookmark),
      export: busyHere(exportFrame),
      mainThumb: busyHere(setMainThumb),
    },
    pendingThumbSec: busyHere(setMainThumb)
      ? (setMainThumb.variables?.sec ?? null)
      : undefined,
  };
}
