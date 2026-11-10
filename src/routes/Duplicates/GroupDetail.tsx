// Right pane of the duplicates view: one group's copies side by side, with the
// parts of each path that set it apart highlighted, so the user can tell which
// copy to keep. Read-only: the actions open, reveal or copy a copy's path.
import { memo, useMemo } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Copy, FolderOpen, Play, Star } from "lucide-react";
import { api } from "@/ipc/client";
import type { DuplicateGroup, FileRow } from "@/ipc/types";
import { fileHref } from "@/lib/fileHref";
import { formatDate } from "@/lib/dates";
import { formatDuration, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { TagChips } from "@/components/TagChips";
import { useI18n } from "@/i18n/I18nProvider";
import { groupName, oldestCopy, reclaimableBytes } from "./groupView";
import { diffPaths, type PathPart } from "./pathDiff";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const PART_CLASS: Record<PathPart["kind"], string> = {
  same: "text-muted",
  diff: "rounded-sm bg-warn/15 px-0.5 text-warn",
  name: "text-fg",
};

interface Props {
  group: DuplicateGroup;
  mediaBase: string;
  /** Workspace labels by ID; null when only one workspace exists. */
  wsLabels: Map<string, string> | null;
  className?: string;
}

// Memoized: typing in the list's search box re-renders the parent, and a
// group can hold any number of copies.
export const GroupDetail = memo(function GroupDetail({
  group,
  mediaBase,
  wsLabels,
  className,
}: Props) {
  const { t, lang } = useI18n();
  const parts = useMemo(
    () => diffPaths(group.files.map((f) => f.relPath)),
    [group.files],
  );
  const hasDiff = parts.some((p) => p.some((part) => part.kind === "diff"));
  const oldest = oldestCopy(group.files);
  const first = group.files[0];
  const meta = [
    formatSize(group.size, "0 B"),
    first.width && first.height ? `${first.width}×${first.height}` : "",
    formatDuration(first.duration, { hours: true }),
  ].filter(Boolean);

  // The same actions, toasts and toast id as useFileActions' single-file
  // openFolder / copyPath (that hook pulls in selection and Watch Later, which
  // this view does not need). Keep the two in step.
  const openFolder = (file: FileRow) => {
    api
      .openFolder(file.id, file.workspaceId)
      .catch((e: unknown) =>
        toast.error(t("folder.openFailed"), { description: errorText(e) }),
      );
  };
  const copyPath = (file: FileRow) => {
    api.copyFilePath(file.id, file.workspaceId).then(
      () => toast.success(t("media.filePathCopied"), { id: "path-copied" }),
      (e: unknown) =>
        toast.error(t("folder.copyFailed"), { description: errorText(e) }),
    );
  };

  return (
    <section
      aria-label={t("duplicates.groupDetail")}
      className={cn("flex min-h-0 flex-col", className)}
    >
      <div className="flex flex-wrap items-start gap-4 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <h2 className="text-base font-semibold break-all text-bright-fg select-text">
            {groupName(group)}
          </h2>
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted tabular-nums">
            {meta.map((m) => (
              <span key={m}>{m}</span>
            ))}
            <span className="font-mono">{group.contentHash.slice(0, 8)}</span>
          </p>
        </div>
        <dl className="flex gap-4 text-right">
          <div>
            <dt className="text-[11px] text-muted">{t("duplicates.copies")}</dt>
            <dd className="text-lg font-semibold text-fg tabular-nums">
              {group.files.length}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">
              {t("duplicates.reclaimable")}
            </dt>
            <dd className="text-lg font-semibold text-warn tabular-nums">
              {formatSize(reclaimableBytes(group), "0 B")}
            </dd>
          </div>
        </dl>
      </div>

      {hasDiff && (
        <p className="flex items-center gap-2 bg-surface px-4 py-1.5 text-xs text-muted">
          <span
            aria-hidden
            className="size-2.5 rounded-sm border border-warn bg-warn/15"
          />
          {t("duplicates.diffLegend")}
        </p>
      )}

      <ol className="page-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {group.files.map((file, i) => {
          const href = fileHref(file.id, file.workspaceId, {
            autoplay: false,
          });
          const wsLabel = wsLabels?.get(file.workspaceId);
          return (
            <li
              key={`${file.workspaceId}:${file.id}`}
              // content-visibility: a group can hold any number of copies, and
              // cards out of view skip style, layout and paint. The intrinsic
              // size stands in until a card is laid out once: the w-36
              // aspect-video thumbnail plus the card's p-2.5 and border.
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface/60 p-2.5 [content-visibility:auto] [contain-intrinsic-size:auto_6.5rem]"
            >
              <Link
                to={href}
                tabIndex={-1}
                aria-hidden
                className="group/thumb relative aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-surface"
              >
                <MediaThumbnail
                  file={file}
                  mediaBase={mediaBase}
                  version={0}
                  fallbackIconSize="size-6"
                  playOverlaySize="size-8"
                  playIconSize="size-4"
                />
                {oldest === file && (
                  <span
                    className="absolute top-1 left-1 rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
                    title={t("duplicates.oldestHint")}
                  >
                    {t("duplicates.oldest")}
                  </span>
                )}
              </Link>
              <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5">
                <p
                  className="font-mono text-[13px] leading-snug break-all select-text"
                  title={file.relPath}
                >
                  {parts[i].map((part, j) => (
                    <span key={j} className={PART_CLASS[part.kind]}>
                      {part.text}
                    </span>
                  ))}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {wsLabel && (
                    <span className="rounded-full bg-overlay px-2 text-fg">
                      {wsLabel}
                    </span>
                  )}
                  <span>
                    {t("duplicates.added", {
                      date: formatDate(new Date(file.addedAt * 1000), lang),
                    })}
                  </span>
                  {file.lastAccessedAt != null && (
                    <span>
                      {t("duplicates.lastViewed", {
                        date: formatDate(
                          new Date(file.lastAccessedAt * 1000),
                          lang,
                        ),
                      })}
                    </span>
                  )}
                  {file.rating > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-accent2">
                      <Star aria-hidden className="size-3 fill-current" />
                      <span aria-hidden>{file.rating}</span>
                      <span className="sr-only">
                        {t("rating.star", { n: file.rating })}
                      </span>
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 gap-1 overflow-x-auto">
                  <TagChips tags={file.tags} />
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <Button asChild variant="outline" size="sm" className="h-7">
                  <Link to={href}>
                    <Play />
                    {t("duplicates.open")}
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 justify-start"
                  onClick={() => openFolder(file)}
                >
                  <FolderOpen />
                  {t("media.openFolder")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 justify-start"
                  onClick={() => copyPath(file)}
                >
                  <Copy />
                  {t("media.copyFilePath")}
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
});
