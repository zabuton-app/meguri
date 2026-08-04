import { useState } from "react";
import { Play } from "lucide-react";
import { kindIcon } from "@/lib/mediaKind";
import type { FileRow } from "@/ipc/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useHoverFramePreview } from "@/hooks/useHoverFramePreview";
import { usePreferences } from "@/settings/PreferencesProvider";
import { cn } from "@/lib/utils";

interface Props {
  file: FileRow;
  /** Base URL of the local media server (status.data.mediaBase). */
  mediaBase: string;
  /** thumb:done cache buster — incrementing the value forces an <img> reload. */
  version: number;
  /** Tailwind size class for the fallback icon (when no thumbnail is available). */
  fallbackIconSize?: string;
  /** Tailwind size class for the play overlay circle (videos only). */
  playOverlaySize?: string;
  /** Tailwind size class for the play icon inside the overlay (videos only). */
  playIconSize?: string;
  /** Set to false to omit the play overlay (e.g. compact table rows). */
  showPlayOverlay?: boolean;
}

/**
 * Shared thumbnail image (with skeleton + fallback icon + optional play overlay) used by Grid / List / Table.
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
  version,
  fallbackIconSize = "size-8",
  playOverlaySize = "size-10",
  playIconSize = "size-5",
  showPlayOverlay = true,
}: Props) {
  // Keys on whether a thumbnail file actually exists, not on kind: audio is
  // marked thumb_status 'done' whether or not it embeds cover art, so status
  // alone would build a URL that 404s for the cover-less ones. Audio *with* a
  // cover renders it like any other thumbnail.
  const hasThumb =
    file.thumbStatus === "done" &&
    file.hasThumb === 1 &&
    mediaBase &&
    file.workspaceId;
  const src = hasThumb
    ? `${mediaBase}/ws/${file.workspaceId}/thumb/${file.id}?v=${version}`
    : undefined;
  const [imgLoaded, setImgLoaded] = useState(false);
  // Holds the URL that failed rather than a bare flag: this component is reused
  // across rows by the virtualizer, so a sticky `true` would hide a perfectly
  // good thumbnail on whichever row recycled the instance.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const { hoverPreview } = usePreferences();
  const { previewSrc, scrubFraction, onMouseEnter, onMouseMove, onMouseLeave } =
    useHoverFramePreview({
      enabled: Boolean(hoverPreview && hasThumb && file.kind === "video"),
      frameUrl: (t) =>
        `${mediaBase}/ws/${file.workspaceId}/frame/${file.id}?t=${t}`,
      duration: file.duration,
      fileId: file.id,
    });

  if (!src || failedSrc === src) {
    // Reached for audio without embedded cover art, for any file whose
    // thumbnail generation failed or has not run yet, and for a recorded
    // thumbnail whose file has since gone missing (without the onError
    // fallback that last case would sit on the skeleton forever).
    const Icon = kindIcon(file.kind);
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Icon className={fallbackIconSize} />
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0"
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
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
      {previewSrc && scrubFraction != null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-bg/40">
          <div
            className="h-full bg-primary"
            style={{ width: `${scrubFraction * 100}%` }}
          />
        </div>
      )}
      {file.kind === "video" && showPlayOverlay && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "flex items-center justify-center rounded-full bg-bg/40 text-fg/80 backdrop-blur-[1px] transition group-hover/thumb:bg-bg/55 group-hover/thumb:text-fg",
              playOverlaySize,
            )}
          >
            <Play className={cn("translate-x-px fill-current", playIconSize)} />
          </span>
        </div>
      )}
    </div>
  );
}
