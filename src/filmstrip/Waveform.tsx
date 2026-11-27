import { useNavigate } from "react-router";
import { fileHref } from "@/lib/fileHref";
import { formatDuration } from "@/lib/format";
import { useI18n } from "@/i18n/I18nProvider";
import type { FileRow } from "@/ipc/types";
import { useLimitedImage, type ImageLimiter } from "@/filmstrip/imageLimiter";
import { FRAME_H } from "@/filmstrip/FrameStrip";

/**
 * An audio file's whole waveform. The server draws it white on transparent;
 * it is used as a mask over a theme color so it reads in every theme. A click
 * opens the file at the time under the pointer.
 */
export function Waveform({
  file,
  duration,
  mediaBase,
  limiter,
  onScreen,
}: {
  file: FileRow;
  duration: number;
  mediaBase: string;
  limiter: ImageLimiter;
  onScreen: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const url = onScreen
    ? `${mediaBase}/ws/${file.workspaceId}/waveform/${file.id}`
    : null;
  const { src } = useLimitedImage(limiter, url);
  const fmt = (sec: number) =>
    formatDuration(sec, { hours: true, fallback: "0:00" });
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <button
        type="button"
        data-slot="filmstrip-waveform"
        aria-label={t("filmstrip.waveform")}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
          const sec =
            rect.width > 0 ? Math.floor((duration * x) / rect.width) : 0;
          void navigate(fileHref(file.id, file.workspaceId, { t: sec }));
        }}
        className="relative z-10 w-full overflow-hidden rounded-item bg-overlay"
        style={{ height: FRAME_H }}
      >
        {src && (
          <span
            aria-hidden
            className="absolute inset-0 bg-primary/80"
            style={{
              maskImage: `url(${src})`,
              maskSize: "100% 100%",
              WebkitMaskImage: `url(${src})`,
              WebkitMaskSize: "100% 100%",
            }}
          />
        )}
      </button>
      <div className="flex justify-between text-2xs leading-4 tabular-nums text-muted">
        <span>{fmt(0)}</span>
        <span>{fmt(Math.floor(duration / 2))}</span>
        <span>{fmt(duration)}</span>
      </div>
    </div>
  );
}
