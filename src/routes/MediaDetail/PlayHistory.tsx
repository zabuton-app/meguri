import type { FileDetail } from "@/ipc/types";
import type { Lang, TFunc } from "@/i18n/I18nProvider";
import { formatDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";

/** The most recent plays of the file. Renders nothing when there are none. */
export function PlayHistory({
  history,
  t,
  lang,
}: {
  history: FileDetail["playHistory"];
  t: TFunc;
  lang: Lang;
}) {
  if (history.length === 0) return null;
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted">
        {t("media.playHistory")}
      </h3>
      <ul className="space-y-1 text-xs text-muted">
        {history.slice(0, 8).map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="tabular-nums text-fg">
              {formatDateTime(new Date(p.playedAt * 1000), lang)}
            </span>
            <Badge variant="outline" className="font-normal">
              {p.via}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
