// The heatmap (the "contribution graph" of the UI): a year of days as a grid of week columns, each cell
// shaded by how many files fall on it. Picking a day sets the filter's date
// range for the metric shown to that day (see pickedDays.ts), which narrows
// the list drawn below.
import { memo, useMemo, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import type { SearchQuery } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/SegmentedControl";
import { ACTIVITY_METRICS, type ActivityMetric } from "@shared/ipc/activity";
import { addDays, formatDay, parseDay } from "@shared/day";
import {
  buildWeeks,
  levelOf,
  LEVELS,
  monthLabels,
  rangeFor,
  WEEK_DAYS,
} from "./calendar";
import { isPicked, pickedDays, singleDay, type PickedDays } from "./pickedDays";
import { useActivityDays } from "./useActivityDays";

const METRIC_LABEL: Record<ActivityMetric, TranslationKey> = {
  played: "heatmap.metric.played",
  captured: "heatmap.metric.captured",
  created: "heatmap.metric.created",
  added: "heatmap.metric.added",
};

const CELL_LABEL: Record<ActivityMetric, TranslationKey> = {
  played: "heatmap.cell.played",
  captured: "heatmap.cell.captured",
  created: "heatmap.cell.created",
  added: "heatmap.cell.added",
};

/** Cell fill per level (see levelOf); level 0 is a day with nothing on it. */
const LEVEL_CLASS = [
  "bg-fg/10",
  "bg-primary/30",
  "bg-primary/55",
  "bg-primary/80",
  "bg-primary",
] as const;

/** Rows that get a weekday name, as GitHub does: Monday, Wednesday, Friday. */
const NAMED_ROWS = new Set([1, 3, 5]);

/** A day's square: as wide as its week column, which shares out the graph's width. */
const CELL = "aspect-square w-full rounded-[2px]";
/** The legend's swatches, which have no column to size them. */
const SWATCH = "size-[11px] rounded-[2px]";
/**
 * Narrowest the graph is drawn before it scrolls sideways instead: below this
 * a year of columns leaves cells too small to pick.
 */
const MIN_WIDTH = "min-w-[30rem]";

/** The page a picked range is shown on: the year ending today when it holds
 *  the range's first day (or nothing is picked), else that day's own year. */
function pageOf(picked: PickedDays | null, today: Date): number | null {
  const day = picked?.from ?? picked?.to;
  const date = day ? parseDay(day) : null;
  if (!date) return null;
  const { from, to } = rangeFor(null, today);
  return date >= from && date <= to ? null : date.getFullYear();
}

const LIST_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Enter",
  " ",
]);

function stopListKeys(e: KeyboardEvent<HTMLElement>) {
  if (LIST_KEYS.has(e.key)) e.stopPropagation();
}

interface Props {
  /** The workspace or collection shown; part of the cache key. */
  scope: string;
  /**
   * The list's filter. The counts cover the files it matches, its date range
   * for the metric shown aside: that range is the day picked here.
   */
  query: SearchQuery;
  ready: boolean;
  metric: ActivityMetric;
  onMetricChange: (metric: ActivityMetric) => void;
  /** Set the filter's range for the metric to this day ("YYYY-MM-DD"), or
   *  remove it for null. */
  onDayChange: (day: string | null) => void;
}

export const HeatmapView = memo(function HeatmapView({
  scope,
  query,
  ready,
  metric,
  onMetricChange,
  onDayChange,
}: Props) {
  const { t, lang } = useI18n();
  // Read once per mount: a heatmap left open over midnight keeps its range
  // rather than shifting under the pointer.
  const [today] = useState(() => new Date());
  const picked = useMemo(() => pickedDays(query, metric), [query, metric]);
  // The label and the clear button speak of one day; a longer range (set in
  // the filter bar) only marks its cells.
  const day = singleDay(picked);
  // Null is the year ending today; a number is that calendar year. The range
  // is part of the filter and outlives this view, so it opens on its page.
  const [year, setYear] = useState<number | null>(() => pageOf(picked, today));

  const range = useMemo(() => rangeFor(year, today), [year, today]);
  const weeks = useMemo(() => buildWeeks(range), [range]);
  const months = useMemo(() => monthLabels(weeks), [weeks]);
  const from = formatDay(range.from);
  const to = formatDay(range.to);

  const { counts, isLoading, isError, isStale } = useActivityDays({
    scope,
    query,
    metric,
    from,
    to,
    enabled: ready,
  });
  const max = useMemo(() => Math.max(0, ...counts.values()), [counts]);

  const { monthName, weekdayName, dateLabel } = useMemo(() => {
    const month = new Intl.DateTimeFormat(lang, { month: "short" });
    const weekday = new Intl.DateTimeFormat(lang, { weekday: "short" });
    const full = new Intl.DateTimeFormat(lang, { dateStyle: "medium" });
    return {
      monthName: (m: number) => month.format(new Date(2024, m, 1)),
      // 2024-09-01 was a Sunday.
      weekdayName: (row: number) => weekday.format(new Date(2024, 8, 1 + row)),
      dateLabel: (d: string) => full.format(parseDay(d) ?? new Date(NaN)),
    };
  }, [lang]);

  const metrics = useMemo(
    () =>
      ACTIVITY_METRICS.map((m) => ({ value: m, label: t(METRIC_LABEL[m]) })),
    [t],
  );

  const showYear = setYear;
  const thisYear = today.getFullYear();

  // One cell is in the tab order (the day picked, else the last one shown);
  // the arrow keys move between the rest.
  const tabStop = day && day >= from && day <= to ? day : to;
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowLeft"
        ? -WEEK_DAYS
        : e.key === "ArrowRight"
          ? WEEK_DAYS
          : e.key === "ArrowUp"
            ? -1
            : e.key === "ArrowDown"
              ? 1
              : 0;
    if (step === 0) return;
    const current = parseDay((e.target as HTMLElement).dataset.day ?? "");
    if (!current) return;
    e.preventDefault();
    const next = formatDay(addDays(current, step));
    if (next < from || next > to) return;
    e.currentTarget.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus();
  };

  return (
    <section
      aria-label={t("view.heatmap")}
      className="shrink-0 border-b border-border bg-bg px-4 py-2"
      // The list below listens on the window for the same keys (card focus,
      // open): one meant for a control or a cell here must not reach it.
      onKeyDown={stopListKeys}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <SegmentedControl<ActivityMetric>
          value={metric}
          options={metrics}
          onChange={onMetricChange}
          label={t("heatmap.metric.label")}
          slot="heatmap-metric"
        />

        <div className="flex items-center gap-1 text-xs text-fg">
          <button
            type="button"
            onClick={() => showYear((year ?? thisYear) - 1)}
            aria-label={t("heatmap.range.prev")}
            title={t("heatmap.range.prev")}
            className="flex size-6 items-center justify-center rounded-md text-muted transition hover:bg-fg/10 hover:text-fg"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span
            className="min-w-24 text-center tabular-nums"
            aria-live="polite"
          >
            {year === null ? t("heatmap.range.last") : year}
          </span>
          <button
            type="button"
            // Past the last whole year comes the year ending today.
            onClick={() =>
              showYear(year !== null && year < thisYear - 1 ? year + 1 : null)
            }
            disabled={year === null}
            aria-label={t("heatmap.range.next")}
            title={t("heatmap.range.next")}
            className="flex size-6 items-center justify-center rounded-md text-muted transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1 text-xs text-muted">
          {isError ? (
            <span role="alert">{t("heatmap.error")}</span>
          ) : day ? (
            <>
              <span className="truncate text-fg">
                {t(CELL_LABEL[metric], {
                  date: dateLabel(day),
                  count: counts.get(day) ?? 0,
                })}
              </span>
              <button
                type="button"
                onClick={() => onDayChange(null)}
                aria-label={t("heatmap.clearDay")}
                title={t("heatmap.clearDay")}
                className="flex size-5 shrink-0 items-center justify-center rounded transition hover:bg-fg/10 hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            </>
          ) : (
            <span className="truncate">{t("heatmap.hint")}</span>
          )}
        </div>
      </div>

      {/* A plain scroller, not ScrollArea: the page-scroll keys look for the
          list's ScrollArea viewport under the same <main> (see
          scrollListByPage) and must not find this one first. */}
      <div className="mt-2 overflow-x-auto pb-1">
        <div
          role="group"
          aria-label={t("view.heatmap")}
          aria-busy={isLoading || isStale}
          onKeyDown={onGridKey}
          className={cn(
            "grid w-full grid-flow-col gap-[3px] transition-opacity",
            MIN_WIDTH,
            (isLoading || isStale) && "opacity-60",
          )}
          style={{
            // The weekday names, then one equal share of the width per week:
            // the cells are squares, so the rows follow the columns.
            gridTemplateColumns: `auto repeat(${weeks.length}, minmax(0, 1fr))`,
            gridTemplateRows: `1rem repeat(${WEEK_DAYS}, auto)`,
          }}
        >
          <span aria-hidden />
          {Array.from({ length: WEEK_DAYS }, (_, row) => (
            <span
              key={row}
              aria-hidden
              className="flex items-center pr-1 text-[10px] leading-none text-muted"
            >
              {NAMED_ROWS.has(row) ? weekdayName(row) : ""}
            </span>
          ))}
          {weeks.map((week, col) => (
            // `contents`: the label and the seven days flow into the parent
            // grid as one column.
            <div key={week.find((d) => d) ?? col} className="contents">
              <span aria-hidden className="relative">
                {months[col] !== null && (
                  <span className="absolute left-0 top-0 whitespace-nowrap text-[10px] leading-4 text-muted">
                    {monthName(months[col])}
                  </span>
                )}
              </span>
              {week.map((d, row) => {
                if (!d) return <span key={row} className={CELL} />;
                const count = counts.get(d) ?? 0;
                const label = t(CELL_LABEL[metric], {
                  date: dateLabel(d),
                  count,
                });
                const marked = isPicked(picked, d);
                return (
                  <button
                    key={d}
                    type="button"
                    data-day={d}
                    data-level={levelOf(count, max)}
                    tabIndex={d === tabStop ? 0 : -1}
                    aria-label={label}
                    aria-pressed={marked}
                    title={label}
                    // The one day picked lets go; any other cell, one inside a
                    // longer range included, becomes the day.
                    onClick={() => onDayChange(d === day ? null : d)}
                    className={cn(
                      CELL,
                      "outline-none transition hover:ring-1 hover:ring-fg/60 focus-visible:ring-2 focus-visible:ring-ring",
                      LEVEL_CLASS[levelOf(count, max)],
                      marked && "ring-2 ring-fg hover:ring-2 hover:ring-fg",
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div
        aria-hidden
        className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted"
      >
        <span>{t("heatmap.less")}</span>
        {Array.from({ length: LEVELS }, (_, level) => (
          <span key={level} className={cn(SWATCH, LEVEL_CLASS[level])} />
        ))}
        <span>{t("heatmap.more")}</span>
      </div>
    </section>
  );
});
