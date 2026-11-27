import { Bookmark } from "lucide-react";
import { HashLink } from "@/components/HashLink";
import { fileHref } from "@/lib/fileHref";
import { formatDuration } from "@/lib/format";
import { useI18n } from "@/i18n/I18nProvider";
import type { FileRow } from "@/ipc/types";

/**
 * A thin bar under the frames, with a bookmark icon at each scene bookmark.
 * The box is tall enough for an icon (hovered, too), the line drawn through
 * its middle: the strip around it clips what overflows (it scrolls
 * sideways), so a mark must not stick out.
 */
export function BookmarkBar({
  file,
  duration,
}: {
  file: FileRow;
  duration: number;
}) {
  const { t } = useI18n();
  const secs = file.bookmarkSecs ?? [];
  return (
    <div className="relative z-10 h-4">
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-fg/10" />
      {secs.map((sec) => {
        const time = formatDuration(sec, { hours: true, fallback: "0:00" });
        return (
          <HashLink
            key={sec}
            data-slot="filmstrip-bookmark"
            to={fileHref(file.id, file.workspaceId, { t: sec })}
            aria-label={t("filmstrip.playFrom", { time })}
            title={time}
            className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 text-primary hover:scale-125"
            style={{ left: `${Math.min(100, (sec / duration) * 100)}%` }}
          >
            <Bookmark className="size-3 fill-current" aria-hidden />
          </HashLink>
        );
      })}
    </div>
  );
}
