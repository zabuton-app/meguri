import { HashLink } from "@/components/HashLink";
import { fileHref } from "@/lib/fileHref";
import { formatDuration } from "@/lib/format";
import { useI18n } from "@/i18n/I18nProvider";
import type { FileRow } from "@/ipc/types";

/** A thin bar under the frames, with a mark at each scene bookmark. */
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
    <div className="relative z-10 h-1.5 rounded-full bg-fg/10">
      {secs.map((sec) => {
        const time = formatDuration(sec, { hours: true, fallback: "0:00" });
        return (
          <HashLink
            key={sec}
            data-slot="filmstrip-bookmark"
            to={fileHref(file.id, file.workspaceId, { t: sec })}
            aria-label={t("filmstrip.playFrom", { time })}
            title={time}
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary hover:scale-125"
            style={{ left: `${Math.min(100, (sec / duration) * 100)}%` }}
          />
        );
      })}
    </div>
  );
}
