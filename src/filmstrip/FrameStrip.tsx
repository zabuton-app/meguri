import { useLayoutEffect, useState, type MouseEvent } from "react";
import { HashLink } from "@/components/HashLink";
import { fileHref } from "@/lib/fileHref";
import { formatDuration } from "@/lib/format";
import { useI18n } from "@/i18n/I18nProvider";
import { usePreferences } from "@/settings/PreferencesProvider";
import type { FileRow } from "@/ipc/types";
import { fitFrameCount, frameTimes, frameWidthFor } from "@/filmstrip/frames";
import { useLimitedImage, type ImageLimiter } from "@/filmstrip/imageLimiter";
import { BookmarkBar } from "@/filmstrip/BookmarkBar";

export const FRAME_H = 72;
const FRAME_GAP = 4;

/** A video's frames at even intervals, its timecodes and its bookmarks. */
export function FrameStrip({
  file,
  duration,
  mediaBase,
  limiter,
  onScreen,
  onFrameClick,
}: {
  file: FileRow;
  duration: number;
  mediaBase: string;
  limiter: ImageLimiter;
  /** Frames load only while their row is on screen. */
  onScreen: boolean;
  /** Returns true when the click was a selection gesture (no navigation). */
  onFrameClick: (e: MouseEvent) => boolean;
}) {
  const { filmstripFrames, frameQuality } = usePreferences();
  const [stripEl, setStripEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // Measured before paint, so a row does not first show one wide frame.
  useLayoutEffect(() => {
    if (!stripEl) return;
    const compute = () => setWidth(stripEl.clientWidth);
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(stripEl);
    return () => ro.disconnect();
  }, [stripEl]);

  // Under auto, nothing until the strip is measured: a count from width 0
  // would request a frame that is dropped as soon as the width is known.
  const count =
    filmstripFrames !== "auto"
      ? filmstripFrames
      : width === 0
        ? 0
        : fitFrameCount(
            width,
            frameWidthFor(FRAME_H, file.width, file.height),
            FRAME_GAP,
          );
  const times = frameTimes(duration, count);
  const base = `${mediaBase}/ws/${file.workspaceId}/frame/${file.id}`;

  return (
    <div ref={setStripEl} className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-w-0" style={{ gap: FRAME_GAP }}>
        {times.map((sec, i) => (
          <Frame
            key={i}
            file={file}
            sec={sec}
            url={onScreen ? `${base}?t=${sec}&q=${frameQuality}` : null}
            limiter={limiter}
            onClick={onFrameClick}
          />
        ))}
      </div>
      <BookmarkBar file={file} duration={duration} />
    </div>
  );
}

function Frame({
  file,
  sec,
  url,
  limiter,
  onClick,
}: {
  file: FileRow;
  sec: number;
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
      className="group/frame relative z-10 flex min-w-0 flex-1 flex-col items-center gap-0.5"
    >
      <div
        className="w-full overflow-hidden rounded-item bg-overlay ring-primary group-hover/frame:ring-2"
        style={{ height: FRAME_H }}
      >
        {src && (
          <img
            src={src}
            alt=""
            draggable={false}
            className="size-full object-cover"
          />
        )}
      </div>
      <span className="text-2xs leading-4 tabular-nums text-muted">{time}</span>
    </HashLink>
  );
}
