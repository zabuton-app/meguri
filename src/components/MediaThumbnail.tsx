import { createElement, useState } from "react";
import { createPortal } from "react-dom";
import { Play } from "lucide-react";
import { kindIcon } from "@/lib/mediaKind";
import { hasThumbFile, thumbUrl } from "@/lib/thumbUrl";
import type { FileRow } from "@/ipc/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useThumbnailScrub } from "@/hooks/useThumbnailScrub";
import { usePreferences } from "@/settings/PreferencesProvider";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { useThumbVersionOf } from "@/lib/thumbVersionStore";

interface Props {
  file: FileRow;
  /** Base URL of the local media server (status.data.mediaBase). */
  mediaBase: string;
  /**
   * thumb:done cache buster — incrementing the value forces an <img> reload.
   * Left out, the thumbnail follows the file's own entry in the shared store
   * (thumbVersionStore), so a regenerated thumbnail re-renders just this one.
   */
  version?: number;
  /** Tailwind size class for the fallback icon (when no thumbnail is available). */
  fallbackIconSize?: string;
  /** Tailwind size class for the play overlay circle (videos only). */
  playOverlaySize?: string;
  /** Tailwind size class for the play icon inside the overlay (videos only). */
  playIconSize?: string;
  /** Set to false to omit the play overlay (e.g. compact table rows). */
  showPlayOverlay?: boolean;
  /** Set to false to turn off the hover scrub preview (e.g. a folder card's mosaic tile). */
  scrubPreview?: boolean;
  /** Set to false to omit the watched-so-far bar (e.g. a folder card's mosaic tile). */
  showProgress?: boolean;
}

/**
 * How far into the file playback was left, as a thin bar along the bottom edge.
 * Only for files in progress: finished and unplayed files carry no resume point.
 */
function ResumeProgress({ progress }: { progress: number }) {
  const { t } = useI18n();
  const percent = Math.round(progress * 100);
  return (
    <div
      data-slot="resume-progress"
      role="progressbar"
      aria-label={t("filter.inProgress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-bg/50"
    >
      <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * Shared thumbnail image (with skeleton + fallback icon + optional play overlay) used by Grid / List.
 *
 * The caller MUST wrap this in a `position: relative` container with a fixed aspect ratio —
 * the image, skeleton and play overlay are all `absolute inset-0` and rely on the parent for layout.
 *
 * The play overlay strengthens via the named group `group/thumb`. Wrap the
 * thumbnail container (Link/cell) with `group/thumb` so the highlight only
 * fires when the thumbnail itself is hovered — not the surrounding metadata.
 *
 * Videos also get a hover scrub preview (the pointer's horizontal position
 * maps onto the video timeline, frames served by the media server's `frame`
 * endpoint), toggleable through the `hoverPreview` preference.
 */
export function MediaThumbnail({
  file,
  mediaBase,
  version: versionProp,
  fallbackIconSize = "size-8",
  playOverlaySize = "size-10",
  playIconSize = "size-5",
  showPlayOverlay = true,
  scrubPreview = true,
  showProgress = true,
}: Props) {
  const storedVersion = useThumbVersionOf(file.workspaceId, file.id);
  const version = versionProp ?? storedVersion;
  // Keys on whether a thumbnail file actually exists, not on kind: audio is
  // marked thumb_status 'done' whether or not it embeds cover art, so status
  // alone would build a URL that 404s for the cover-less ones. Audio *with* a
  // cover renders it like any other thumbnail.
  const src = hasThumbFile(file)
    ? (thumbUrl(mediaBase, file.workspaceId, file.id, version) ?? undefined)
    : undefined;
  // Also false until the media origin is known, so nothing tries to load early.
  const hasThumb = src !== undefined;
  const [imgLoaded, setImgLoaded] = useState(false);
  // Holds the URL that failed rather than a bare flag: this component is reused
  // across rows by the virtualizer, so a sticky `true` would hide a perfectly
  // good thumbnail on whichever row recycled the instance.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const { hoverPreview, frameQuality } = usePreferences();
  const { ref, previewSrc, scrubFraction, clean, enlargedBounds } =
    useThumbnailScrub({
      enabled: Boolean(
        scrubPreview &&
        hoverPreview &&
        hasThumb &&
        failedSrc !== src &&
        file.kind === "video",
      ),
      frameUrl: (t) =>
        `${mediaBase}/ws/${file.workspaceId}/frame/${file.id}?t=${t}&q=${frameQuality}`,
      duration: file.duration,
      fileId: `${file.workspaceId}:${file.id}`,
    });

  const progress =
    showProgress && file.progress != null && file.progress > 0
      ? file.progress
      : null;

  if (!src || failedSrc === src) {
    // Reached for audio without embedded cover art, for any file whose
    // thumbnail generation failed or has not run yet, and for a recorded
    // thumbnail whose file has since gone missing (without the onError
    // fallback that last case would sit on the skeleton forever).
    return (
      <div className="flex h-full w-full items-center justify-center">
        {createElement(kindIcon(file.kind), { className: fallbackIconSize })}
        {progress != null && <ResumeProgress progress={progress} />}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-scrub-mode={clean ? "clean" : undefined}
      className="absolute inset-0"
    >
      {!imgLoaded && <Skeleton className="absolute inset-0 rounded-none" />}
      <img
        src={src}
        alt={file.relPath}
        loading="lazy"
        onLoad={() => setImgLoaded(true)}
        onError={() => setFailedSrc(src)}
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity",
          imgLoaded ? "opacity-100" : "opacity-0",
        )}
      />
      {previewSrc && (
        <img
          src={previewSrc}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* The scrub bar takes the same edge while the pointer is over it. */}
      {!clean && progress != null && !(previewSrc && scrubFraction != null) && (
        <ResumeProgress progress={progress} />
      )}
      {!clean && previewSrc && scrubFraction != null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-bg/40">
          <div
            className="h-full bg-primary"
            style={{ width: `${scrubFraction * 100}%` }}
          />
        </div>
      )}
      {!clean && file.kind === "video" && showPlayOverlay && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "flex items-center justify-center rounded-full bg-bg/40 text-fg/80 transition group-hover/thumb:bg-bg/55 group-hover/thumb:text-fg",
              playOverlaySize,
            )}
          >
            <Play className={cn("translate-x-px fill-current", playIconSize)} />
          </span>
        </div>
      )}
      {enlargedBounds &&
        createPortal(
          <div
            data-slot="enlarged-scrub-preview"
            aria-hidden="true"
            className="pointer-events-none fixed z-50 overflow-hidden rounded-md bg-black shadow-2xl ring-1 ring-border"
            style={{ ...enlargedBounds }}
          >
            <img
              src={previewSrc ?? src}
              alt=""
              className="h-full w-full object-contain"
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
