import type { MouseEvent } from "react";
import { HashLink } from "@/components/HashLink";
import { fileHref } from "@/lib/fileHref";
import { formatDuration } from "@/lib/format";
import { useI18n } from "@/i18n/I18nProvider";
import { usePreferences } from "@/settings/PreferencesProvider";
import type { FileRow } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { FRAME_GAP, frameTimes, type StripLayout } from "@/filmstrip/frames";
import { useLimitedImage, type ImageLimiter } from "@/filmstrip/imageLimiter";
import { BookmarkBar } from "@/filmstrip/BookmarkBar";

/** A video's frames at even intervals, its timecodes and its bookmarks. */
export function FrameStrip({
  file,
  duration,
  layout,
  mediaBase,
  limiter,
  onScreen,
  onFrameClick,
}: {
  file: FileRow;
  duration: number;
  layout: StripLayout;
  mediaBase: string;
  limiter: ImageLimiter;
  /** Frames load only while their row is on screen. */
  onScreen: boolean;
  /** Returns true when the click was a selection gesture (no navigation). */
  onFrameClick: (e: MouseEvent) => boolean;
}) {
  const { filmstripFrames, frameQuality } = usePreferences();
  // The times follow the count alone, never the width: a resize (a side peek
  // docking) keeps the same frames, which are only drawn larger or smaller.
  const times = frameTimes(duration, filmstripFrames);
  const base = `${mediaBase}/ws/${file.workspaceId}/frame/${file.id}`;

  return (
    <div
      className={cn(
        "relative z-10 min-w-0 flex-1 overflow-y-hidden",
        layout.scrolls ? "overflow-x-auto pb-1" : "overflow-x-hidden",
      )}
    >
      <div className="flex w-max flex-col gap-1">
        <div className="flex" style={{ gap: FRAME_GAP }}>
          {times.map((sec, i) => (
            <Frame
              key={i}
              file={file}
              sec={sec}
              layout={layout}
              url={onScreen ? `${base}?t=${sec}&q=${frameQuality}` : null}
              limiter={limiter}
              onClick={onFrameClick}
            />
          ))}
        </div>
        <BookmarkBar file={file} duration={duration} />
      </div>
    </div>
  );
}

function Frame({
  file,
  sec,
  layout,
  url,
  limiter,
  onClick,
}: {
  file: FileRow;
  sec: number;
  layout: StripLayout;
  url: string | null;
  limiter: ImageLimiter;
  onClick: (e: MouseEvent) => boolean;
}) {
  const { t } = useI18n();
  const { src, failed } = useLimitedImage(limiter, url);
  const time = formatDuration(sec, { hours: true, fallback: "0:00" });
  return (
    <HashLink
      data-slot="filmstrip-frame"
      data-failed={failed || undefined}
      to={fileHref(file.id, file.workspaceId, { t: sec })}
      onClick={onClick}
      aria-label={t("filmstrip.playFrom", { time })}
      className="group/frame flex shrink-0 flex-col items-center gap-0.5"
    >
      <div
        data-slot="filmstrip-frame-box"
        className="overflow-hidden rounded-item bg-black ring-primary group-hover/frame:ring-2"
        style={{ width: layout.frameW, height: layout.frameH }}
      >
        {src && (
          <img
            src={src}
            alt=""
            draggable={false}
            className="size-full object-contain"
          />
        )}
      </div>
      <span className="text-2xs leading-4 tabular-nums text-muted">{time}</span>
    </HashLink>
  );
}
