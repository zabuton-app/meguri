// The selection bar's write side: favorite, rating and Watch Later over the
// whole selection.
//
// Each of these has a per-file control elsewhere (FavoriteButton, RatingButton,
// WatchLaterButton) that owns its own mutation. The bulk equivalents cannot just
// call those in a loop — favorite and rating would be one IPC round trip per
// file, and Watch Later lives in config.json, which is rewritten whole on every
// change — so each has a channel that takes the whole selection at once.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import { useSelection } from "@/components/SelectionContext";
import { useI18n } from "@/i18n/I18nProvider";
import { bulkTargets } from "@/lib/bulkEdit";
import {
  invalidateCollectionSearches,
  invalidateFileCaches,
  syncFileRowAcrossCaches,
} from "@/lib/queryCache";
import type { FileRow } from "@/ipc/types";

export interface BulkMetaPatch {
  favorite?: boolean;
  rating?: number;
}

export interface BulkEditActions {
  /** Flip the whole selection's favorite flag. */
  setFavorite: (favorite: boolean) => void;
  /** Set the whole selection's rating (0 clears it). */
  setRating: (rating: number) => void;
  /** Add the whole selection to Watch Later, or take it off. */
  setWatchLater: (member: boolean) => void;
  /** True while any of the three is in flight. */
  pending: boolean;
}

export function useBulkEdit(
  rows: FileRow[],
  /** Watch Later's collection id, or null while the workspace list is loading. */
  watchLaterId: string | null,
  /**
   * Skip the collection-search invalidation, the way WatchLaterButton does while
   * the detail view is open: refetching a collection-scoped list with a file open
   * drops that file out of the prev/next order. MediaDetail flushes those caches
   * when it closes, so the refresh is deferred rather than lost — which is why
   * this must only be set while it is actually mounted.
   */
  deferListRefresh = false,
): BulkEditActions {
  const { t } = useI18n();
  const qc = useQueryClient();

  const { patch: patchSelection } = useSelection();

  const fail = (e: unknown) =>
    toast.error(
      t("select.bulkFailed", {
        msg: e instanceof Error ? e.message : String(e),
      }),
    );

  const meta = useMutation({
    // The rows are captured here, when the click happens, and carried through
    // to onSuccess. react-query hands an in-flight mutation the newest render's
    // options, so reading `rows` in onSuccess would read the selection as it is
    // when the write lands — patching files the write never touched (and, once
    // they all read as favorites, flipping the next click to "unfavorite").
    mutationFn: async (patch: BulkMetaPatch) => {
      const written = rows;
      const result = await api.filesBulkMeta(bulkTargets(written), patch);
      return { result, written };
    },
    onSuccess: ({ result, written }, patch) => {
      // Two steps, and both are needed.
      //
      // The patch is what makes the change instant: the new value is known for
      // every row that was sent, so those rows need no re-read.
      //
      // The reconcile covers what the patch cannot know. The write goes by
      // meta_key, so a file sharing a content hash with a selected one changed
      // as well and is not in `written` to patch; and a file whose row had
      // already gone is only reported as a count in `skipped`, so it would
      // otherwise sit there showing a value that was never written.
      const rowPatch: Partial<FileRow> = {};
      if (patch.favorite !== undefined) {
        rowPatch.favorite = patch.favorite ? 1 : 0;
      }
      if (patch.rating !== undefined) rowPatch.rating = patch.rating;
      for (const row of written) {
        syncFileRowAcrossCaches(qc, row.workspaceId, row.id, rowPatch);
      }
      // The selection's own copies: a picked folder's files and rows the list
      // no longer holds are in no query cache for the patch above to reach.
      patchSelection(written, rowPatch);
      invalidateFileCaches(qc);
      // One line per field the call actually set, so a future call that sets
      // both does not silently report only one of them.
      const lines: string[] = [];
      if (patch.favorite !== undefined) {
        lines.push(
          patch.favorite
            ? t("select.favoriteAdded", { count: result.files })
            : t("select.favoriteRemoved", { count: result.files }),
        );
      }
      if (patch.rating !== undefined) {
        lines.push(
          patch.rating === 0
            ? t("select.ratingCleared", { count: result.files })
            : t("select.ratingApplied", {
                count: result.files,
                rating: patch.rating,
              }),
        );
      }
      if (lines.length > 0) toast.success(lines.join(" / "));
    },
    onError: (e) => {
      // Each workspace commits on its own (see files_bulk_meta), so a call
      // that failed may still have written the workspaces ahead of the one
      // that threw: re-read rather than leave those showing the old values.
      // (A selected row the list no longer holds keeps its snapshot: which
      // workspaces were written is not something the failure says.)
      invalidateFileCaches(qc);
      fail(e);
    },
  });

  const watchLater = useMutation({
    mutationFn: (member: boolean) => {
      if (!watchLaterId) throw new Error("watch later is not available yet");
      return api.collectionSetMembership(
        watchLaterId,
        bulkTargets(rows),
        member ? "add" : "remove",
      );
    },
    onSuccess: (result, member) => {
      // Membership is not on the file rows — it lives on the collection in the
      // workspace list, so that one query is what has to be re-read. The
      // collection-scoped lists go with it: every other membership write in the
      // app pairs these two, and a Watch Later view open while the selection is
      // taken off it has to drop those rows.
      void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
      if (!deferListRefresh) invalidateCollectionSearches(qc);
      toast.success(
        member
          ? t("select.watchLaterAdded", { count: result.changed })
          : t("select.watchLaterRemoved", { count: result.changed }),
      );
    },
    onError: fail,
  });

  return {
    setFavorite: (favorite: boolean) => meta.mutate({ favorite }),
    setRating: (rating: number) => meta.mutate({ rating }),
    setWatchLater: (member: boolean) => watchLater.mutate(member),
    pending: meta.isPending || watchLater.isPending,
  };
}
