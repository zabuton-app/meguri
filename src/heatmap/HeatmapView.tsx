// The heatmap (the "contribution graph" of the UI): a year of days as a grid of week columns, each cell
// shaded by how many files fall on it. A panel over the list, in any view:
// picking a day, or dragging across several, sets the filter's date range for
// the metric shown (see pickedDays.ts), which narrows the list drawn below.
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
import {
  isPicked,
  orderedRange,
  pickedDays,
  singleDay,
  type DayRange,
  type PickedDays,
} from "./pickedDays";
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

/**
 * A day's cell: as wide as its week column, which shares out the panel's
 * width, and no taller than a few pixels — square while the columns are
 * narrow, a low bar once they are wide, so a wide window does not make the
 * panel tall at the list's expense.
 */
const CELL = "aspect-square max-h-2.5 w-full rounded-[2px]";
/** The legend's swatches, which have no column to size them. */
const SWATCH = "size-2.5 rounded-[2px]";
/**
 * Narrowest the graph is drawn before it scrolls sideways instead: below this
 * a year of columns leaves cells too small to pick.
 */
const MIN_WIDTH = "min-w-[30rem]";

/** The page a picked range is shown on: the year ending today unless the
 *  range's first day is before it, which opens that day's own year. */
function pageOf(picked: PickedDays | null, today: Date): number | null {
  const day = picked?.from ?? picked?.to;
  const date = day ? parseDay(day) : null;
  if (!date) return null;
  const { from } = rangeFor(null, today);
  // A day past today has no page of its own (no year runs beyond today): it
  // stays on the year ending today, where it simply has no cell.
  return date >= from ? null : date.getFullYear();
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
  /** Set the filter's range for the metric to these days, or remove it for
   *  null. */
  onRangeChange: (range: DayRange | null) => void;
}

/** The day of the cell an event came from, if it came from one. */
function dayOfTarget(target: EventTarget | null): string | null {
  return target instanceof HTMLElement ? (target.dataset.day ?? null) : null;
}

export const HeatmapView = memo(function HeatmapView({
  scope,
  query,
  ready,
  metric,
  onMetricChange,
  onRangeChange,
}: Props) {
  const { t, lang } = useI18n();
  // Read once per mount: a heatmap left open over midnight keeps its range
  // rather than shifting under the pointer.
  const [today] = useState(() => new Date());
  const picked = useMemo(() => pickedDays(query, metric), [query, metric]);
  // A drag in progress: where it started and the cell it is over now. Shown
  // as the range it would pick, and written to the filter only on release.
  const [drag, setDrag] = useState<{ anchor: string; head: string } | null>(
    null,
  );
  // What the cells and the label show: the drag while there is one.
  const shown = useMemo<PickedDays | null>(
    () => (drag ? orderedRange(drag.anchor, drag.head) : picked),
    [drag, picked],
  );
  // One day gets its count in the label; a longer range is named by its ends.
  const day = singleDay(shown);
  // Null is the year ending today; a number is that calendar year. The range
  // is part of the filter and outlives this view, so it opens on its page.
  const [year, setYear] = useState<number | null>(() => pageOf(picked, today));
  // A range set from outside the view (the panel, a saved search) turns to
  // its page as well. One picked here is already on the page shown, so paging
  // away from it afterwards is left alone.
  const pickedFrom = picked?.from ?? picked?.to ?? null;
  const [followed, setFollowed] = useState(pickedFrom);
  if (pickedFrom !== followed) {
    setFollowed(pickedFrom);
    const page = rangeFor(year, today);
    const date = pickedFrom ? parseDay(pickedFrom) : null;
    if (date && (date < page.from || date > page.to))
      setYear(pageOf(picked, today));
  }

  // A press on the one day picked lets it go; on any other cell it becomes
  // the day. With Shift, the range runs from where the one shown starts.
  const pick = (range: DayRange, extend: boolean) => {
    const start = picked?.from ?? picked?.to;
    if (range.from !== range.to) onRangeChange(range);
    else if (extend && start) onRangeChange(orderedRange(start, range.from));
    else if (range.from === singleDay(picked)) onRangeChange(null);
    else onRangeChange(range);
  };
  // The release is caught on the window: a drag may end outside the grid.
  const latest = useRef({ drag, pick });
  useEffect(() => {
    latest.current = { drag, pick };
  });
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const end = (e: PointerEvent) => {
      const { drag, pick } = latest.current;
      setDrag(null);
      if (drag && e.type === "pointerup")
        pick(orderedRange(drag.anchor, drag.head), e.shiftKey);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setDrag(null);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragging]);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dayOfTarget(e.target);
    if (!d || e.button !== 0) return;
    // A touch is captured by the cell it lands on; let go, so the cells it
    // moves over report it.
    const el = e.target as HTMLElement;
    if (el.hasPointerCapture?.(e.pointerId))
      el.releasePointerCapture(e.pointerId);
    setDrag({ anchor: d, head: d });
  };
  const onPointerOver = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dayOfTarget(e.target);
    if (d)
      setDrag((cur) => (cur && cur.head !== d ? { ...cur, head: d } : cur));
  };

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

  const dayCounted =
    day != null && day >= from && day <= to && !isLoading && !isStale;
  const thisYear = today.getFullYear();

  // One cell is in the tab order (the first day picked, else the last one
  // shown); the arrow keys move between the rest.
  const first = picked?.from;
  const tabStop = first && first >= from && first <= to ? first : to;
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
      className="shrink-0 border-b border-border bg-bg px-4 py-1.5"
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
            onClick={() => setYear((year ?? thisYear) - 1)}
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
              setYear(year !== null && year < thisYear - 1 ? year + 1 : null)
            }
            disabled={year === null}
            aria-label={t("heatmap.range.next")}
            title={t("heatmap.range.next")}
            className="flex size-6 items-center justify-center rounded-md text-muted transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* On the controls' row rather than under the grid: a row of its own
            is height the list below would rather have. */}
        <div
          aria-hidden
          className="flex items-center gap-1 text-[10px] text-muted"
        >
          <span>{t("heatmap.less")}</span>
          {Array.from({ length: LEVELS }, (_, level) => (
            <span key={level} className={cn(SWATCH, LEVEL_CLASS[level])} />
          ))}
          <span>{t("heatmap.more")}</span>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1 text-xs text-muted">
          {isError ? (
            <span role="alert">{t("heatmap.error")}</span>
          ) : shown ? (
            <>
              <span className="truncate text-fg">
                {/* The counts cover the page shown: a day on another page (or
                    past today, or still loading) is named without one, rather
                    than with a zero the list below would contradict. */}
                {day == null
                  ? `${shown.from ? dateLabel(shown.from) : "…"} – ${shown.to ? dateLabel(shown.to) : "…"}`
                  : dayCounted
                    ? t(CELL_LABEL[metric], {
                        date: dateLabel(day),
                        count: counts.get(day) ?? 0,
                      })
                    : dateLabel(day)}
              </span>
              <button
                type="button"
                onClick={() => onRangeChange(null)}
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
      <div className="mt-1.5 overflow-x-auto pb-0.5">
        <div
          role="group"
          aria-label={t("view.heatmap")}
          aria-busy={isLoading || isStale}
          onKeyDown={onGridKey}
          onPointerDown={onPointerDown}
          onPointerOver={onPointerOver}
          className={cn(
            "grid w-full select-none grid-flow-col gap-[3px] transition-opacity",
            MIN_WIDTH,
            (isLoading || isStale) && "opacity-60",
          )}
          style={{
            // The weekday names, then one equal share of the width per week;
            // the rows are as tall as the cells make them (see CELL).
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
                const marked = isPicked(shown, d);
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
                    // The pointer picks on release (see the drag above); this
                    // is the keyboard's Enter and Space, whose click carries
                    // no press count.
                    onClick={(e) => {
                      if (e.detail === 0) pick({ from: d, to: d }, e.shiftKey);
                    }}
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
    </section>
  );
});
