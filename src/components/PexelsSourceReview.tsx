import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/ipc/client";
import { fileNameOf } from "@/lib/relPath";
import { thumbUrl } from "@/lib/thumbUrl";
import type { ChannelInput } from "@shared/ipc/channels";
import { MAX_SOURCE_URL, parsePexelsVideoUrl } from "@shared/pexelsSource";

export type PexelsReviewScope = ChannelInput<"pexels_sources_preview">;
type ReviewLabel =
  "source.recover" | "source.recoverFolder" | "source.recoverMatching";
const PAGE_SIZE = 20;

export function PexelsReviewButton({
  scope,
  label,
}: {
  scope: PexelsReviewScope;
  label: ReviewLabel;
}) {
  const { t } = useI18n();
  const [review, setReview] = useState<PexelsReviewScope | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-muted/35 bg-surface"
        onClick={() => setReview(scope)}
      >
        <Link2 className="size-3.5" />
        {t(label)}
      </Button>
      {review && (
        <PexelsSourceReview scope={review} onClose={() => setReview(null)} />
      )}
    </>
  );
}

export function PexelsSourceReview({
  scope,
  onClose,
}: {
  scope: PexelsReviewScope;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const mediaBase = useAppStatus().data?.mediaBase ?? "";
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["pexels_sources_preview", scope],
    queryFn: () => api.previewPexelsSources(scope),
    staleTime: 0,
  });
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ key: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = data?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const keyOf = (row: (typeof rows)[number]) =>
    JSON.stringify([row.workspaceId, row.id]);
  const edits = rows.flatMap((row) =>
    picked.has(keyOf(row)) && row.suggestion
      ? [
          {
            workspaceId: row.workspaceId,
            id: row.id,
            metaKey: row.metaKey,
            source: row.suggestion.url,
          },
        ]
      : [],
  );

  const write = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch {
      toast.error(t("source.saveFailed"));
    } finally {
      await refetch();
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        data-source-review
        className="flex max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl flex-col overflow-hidden"
      >
        <DialogHeader className="shrink-0 px-5 pb-2 pt-5 pr-9">
          <DialogTitle>{t("source.recover")}</DialogTitle>
          <DialogDescription>
            {t("source.reviewHint")}{" "}
            {t(
              "targets" in scope
                ? "source.selectionHint"
                : "folder" in scope
                  ? "source.folderHint"
                  : "source.globalHint",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 pb-2">
          {isPending && (
            <p role="status" className="py-4 text-sm text-muted">
              {t("source.loading")}
            </p>
          )}
          {isError && (
            <p role="alert" className="py-4 text-sm">
              {t("source.readFailed")}
            </p>
          )}
          {data?.overLimit && (
            <p role="status" className="py-4 text-sm">
              {t("source.overLimit")}
            </p>
          )}
          {data && !data.overLimit && rows.length === 0 && (
            <p className="py-4 text-sm">{t("source.noVideos")}</p>
          )}
          {rows
            .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
            .map((row) => {
              const key = keyOf(row);
              const source = row.saved ?? row.suggestion;
              const name = fileNameOf(row.relPath);
              const dot = name.lastIndexOf(".");
              const container =
                dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
              const thumb = thumbUrl(mediaBase, row.workspaceId, row.id);
              const target = {
                workspaceId: row.workspaceId,
                id: row.id,
                metaKey: row.metaKey,
              };
              const saveOne = (url: string | null) =>
                void write(async () => {
                  if (!(await api.setPexelsSource({ ...target, source: url })))
                    throw new Error("Source changed");
                  setPicked((old) => {
                    const next = new Set(old);
                    next.delete(key);
                    return next;
                  });
                  setEdit(null);
                  toast.success(t(url ? "source.updated" : "source.removed"));
                });
              return (
                <article
                  key={key}
                  className="flex items-start gap-3 border-t border-border py-3"
                >
                  <div className="w-28 shrink-0">
                    {thumb && (
                      <img
                        src={thumb}
                        alt={t("source.libraryPreview")}
                        loading="lazy"
                        className="aspect-video w-full rounded bg-surface object-contain"
                      />
                    )}
                    <p className="mt-1 text-xs text-muted">
                      {row.width && row.height
                        ? `${row.width} × ${row.height}`
                        : t("source.resolutionUnknown")}
                      {container && (
                        <span className="ml-1 rounded border border-border px-1 font-medium text-fg">
                          {container}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <h3
                      title={row.relPath}
                      className="truncate text-sm font-medium"
                    >
                      {container
                        ? row.relPath.slice(0, -container.length - 1)
                        : row.relPath}
                    </h3>
                    <p className="text-xs text-muted">
                      {t(
                        row.saved
                          ? "source.alreadySaved"
                          : source
                            ? "source.suggested"
                            : "source.unknown",
                      )}
                      {source && ` · Pexels ${source.videoId}`}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {row.suggestion && (
                        <label className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            aria-label={`${t("source.saveThisLink")} — ${row.relPath}`}
                            disabled={busy}
                            checked={picked.has(key)}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setPicked((old) => {
                                const next = new Set(old);
                                if (checked) next.add(key);
                                else next.delete(key);
                                return next;
                              });
                            }}
                          />
                          {t("source.saveThisLink")}
                        </label>
                      )}
                      {source && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void api
                              .openUrl(source.url)
                              .catch(() => toast.error(t("source.openFailed")))
                          }
                        >
                          {t("source.open")}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          setEdit({ key, url: row.saved?.url ?? "" })
                        }
                      >
                        {t(row.saved ? "source.edit" : "source.paste")}
                      </Button>
                      {row.saved && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => saveOne(null)}
                        >
                          {t("source.remove")}
                        </Button>
                      )}
                    </div>
                    {edit?.key === key && (
                      <form
                        className="flex gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const valid = parsePexelsVideoUrl(edit.url);
                          if (valid) saveOne(valid.url);
                          else toast.error(t("source.invalid"));
                        }}
                      >
                        <input
                          type="text"
                          inputMode="url"
                          aria-label={t("source.url")}
                          placeholder="https://www.pexels.com/video/…"
                          maxLength={MAX_SOURCE_URL}
                          className="min-w-0 flex-1 rounded border border-border bg-surface px-2 text-sm"
                          value={edit.url}
                          disabled={busy}
                          onChange={(event) =>
                            setEdit({ key, url: event.target.value })
                          }
                        />
                        <Button
                          type="submit"
                          size="sm"
                          disabled={busy || !edit.url.trim()}
                        >
                          {t("source.saveThisLink")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setEdit(null)}
                        >
                          {t("common.cancel")}
                        </Button>
                      </form>
                    )}
                  </div>
                </article>
              );
            })}
        </div>

        <DialogFooter className="shrink-0 flex-wrap gap-2 border-t border-border px-5 py-3">
          {pageCount > 1 && (
            <div className="mr-auto flex items-center gap-2 text-xs">
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {t("source.previous")}
              </Button>
              {t("source.page", { current: currentPage + 1, total: pageCount })}
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage + 1 === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                {t("source.next")}
              </Button>
            </div>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            size="sm"
            disabled={busy || edits.length === 0}
            onClick={() =>
              void write(async () => {
                const result = await api.savePexelsSources(edits);
                setPicked(new Set());
                if (result.skipped) toast.info(t("source.skipped", result));
                else
                  toast.success(
                    t("source.savedCount", { count: result.saved }),
                  );
              })
            }
          >
            {t("source.saveLinks", { count: edits.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
