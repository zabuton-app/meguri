// The first launch after the upgrade merges every workspace's metadata into
// the library they all share (main's mergeWorkspacesIntoLibrary). This modal
// holds the window while it runs, with how many workspaces are done, and says
// afterwards if any could not be merged.
//
// Progress comes from the library:merge event. app_status carries it too, and
// is read again every second while the modal is up: the window can load
// mid-merge, and the event that ends it can go out before this component has
// subscribed. Either way the modal closes once, when it learns the merge is
// over.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  LibraryMergeFailure,
  LibraryMergeProgress,
} from "@shared/ipc/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStatus } from "@/hooks/useAppStatus";
import { api, events } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";

const POLL_MS = 1000;

export function LibraryMergeModal() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const status = useAppStatus({
    refetchInterval: (data) => (data?.libraryMerge ? POLL_MS : false),
  });
  const [progress, setProgress] = useState<LibraryMergeProgress | null>(null);
  const [finished, setFinished] = useState(false);
  // Whether a merge has been seen running, so a status without one means it
  // ended rather than that none was due.
  const seen = useRef(false);
  const ended = useRef(false);

  // "Try again": the merge runs once more and this modal follows it again.
  // Main reports it pending as soon as it takes the request, before the
  // first progress event: the status read then brings the modal up, and
  // replaces the one that still lists the last failures.
  const retry = useCallback(() => {
    ended.current = false;
    seen.current = false;
    setFinished(false);
    void api
      .libraryMergeRetry()
      .then(() => qc.invalidateQueries({ queryKey: ["app_status"] }));
  }, [qc]);

  const finish = useCallback(
    (failed: LibraryMergeFailure[]) => {
      if (ended.current) return;
      ended.current = true;
      setProgress(null);
      setFinished(true);
      // Everything read before was "not ready yet": read it all again.
      void qc.invalidateQueries();
      if (failed.length > 0) {
        const list = failed
          .map(({ label, reason }) =>
            t("libraryMerge.failedItem", {
              name: label,
              reason: t(`libraryMerge.reason.${reason}`),
            }),
          )
          .join("\n");
        toast.warning(t("libraryMerge.failed"), {
          id: "library-merge-failed",
          description: (
            <span className="whitespace-pre-line">
              {t("libraryMerge.failedDesc", { list })}
            </span>
          ),
          duration: Infinity,
          action: { label: t("libraryMerge.retry"), onClick: retry },
        });
      }
    },
    [qc, retry, t],
  );

  useEffect(() => {
    return events.onLibraryMerge((e) => {
      if (e.state === "running") {
        seen.current = true;
        setProgress({ done: e.done, total: e.total });
      } else {
        finish(e.failed);
      }
    });
  }, [finish]);

  const data = status.data;
  useEffect(() => {
    if (!data) return;
    if (data.libraryMerge) seen.current = true;
    // Over: seen running, or already over by the first status (a merge that
    // ended before this window asked), when it has failures to tell.
    else if (seen.current || data.libraryMergeFailed?.length) {
      finish(data.libraryMergeFailed ?? []);
    }
  }, [data, finish]);

  const shown = finished ? null : (progress ?? data?.libraryMerge);
  if (!shown) return null;
  const percent =
    shown.total > 0 ? Math.round((shown.done / shown.total) * 100) : 0;

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="p-6"
      >
        <DialogHeader>
          <DialogTitle>{t("libraryMerge.title")}</DialogTitle>
          <DialogDescription>{t("libraryMerge.description")}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-2">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={shown.total}
            aria-valuenow={shown.done}
            aria-label={t("libraryMerge.title")}
            className="h-2 w-full overflow-hidden rounded-full bg-surface"
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-right text-sm tabular-nums text-muted">
            {t("libraryMerge.progress", {
              done: shown.done,
              total: shown.total,
            })}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
