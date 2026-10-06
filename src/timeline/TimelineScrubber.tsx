// The timeline's rail, in the manner of a photo library's scrollbar: the
// whole list at the height of the view as one column of dots — a larger dot
// per month, a smaller one per day — with the years written beside it and a
// grip at the list's position. Dragging the grip, or pressing anywhere on
// the track, scrolls the list there while a chip names the day under the
// pointer. From the keyboard it is a slider over the months: the arrows move
// the list a month at a time.
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronsUpDown } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { UNDATED } from "./layout";
import { dayLabel, monthLabel, yearOf } from "./dates";

/** Pixels two year labels must be apart to both be written. */
const LABEL_GAP = 18;

/** One day of the list as the rail sees it. */
export interface RailDay {
  /** "YYYY-MM-DD". */
  key: string;
  count: number;
  /** Scroll offset of the day's header (see RailMonth.top). */
  top: number;
}

/**
 * One month of the list as the rail sees it: where its first day starts and
 * how many files it holds. The undated tail is one more, keyed UNDATED.
 */
export interface RailMonth {
  /** "YYYY-MM", or UNDATED for the tail. */
  key: string;
  count: number;
  /**
   * Scroll offset of the month's first header, on the scale of `totalSize`:
   * TimelineView sums the same estimates the virtualizer places rows by.
   */
  top: number;
}

interface Props {
  months: RailMonth[];
  /** The days with files, newest first (the undated tail is not a day). */
  days: RailDay[];
  /** The list's whole height, and the height of the view onto it. */
  totalSize: number;
  viewHeight: number;
  scrollTop: number;
  /** Month key (or UNDATED) of the section at the top of the list. */
  current: string | null;
  /** Scrolls the list to an offset (dragging, pressing the track). */
  onScrollTo: (offset: number) => void;
  /** Scrolls the list to a month's first header (the keyboard). */
  onJump: (key: string) => void;
}

export const TimelineScrubber = memo(function TimelineScrubber({
  months,
  days,
  totalSize,
  viewHeight,
  scrollTop,
  current,
  onScrollTo,
  onJump,
}: Props) {
  const { t, lang } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const [trackHeight, setTrackHeight] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => setTrackHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The track is the distance the list scrolls: the grip at the bottom is
  // the list at its end, and a dot's place is where the list stands when
  // that date is at the top (dates in the last screenful sit at the end).
  const maxScroll = Math.max(0, totalSize - viewHeight);
  const span = Math.max(1, maxScroll);
  /** Where on the track (0..1) a scroll offset sits. */
  const fractionOf = (offset: number) =>
    Math.min(1, Math.max(0, offset / span));

  const label = useCallback(
    (section: RailMonth) =>
      t("timeline.month", {
        month:
          section.key === UNDATED
            ? t("timeline.undated")
            : monthLabel(section.key, lang),
        count: section.count,
      }),
    [t, lang],
  );

  // A year is written at its newest month; one too close to the year above
  // it on the track is left out, and the undated tail is named like a year.
  const yearLabels = useMemo(() => {
    const out: { key: string; text: string; top: number }[] = [];
    let seen = "";
    let lastY = -Infinity;
    for (const s of months) {
      const text = s.key === UNDATED ? t("timeline.undated") : yearOf(s.key);
      if (text === seen) continue;
      seen = text;
      const y = fractionOf(s.top) * trackHeight;
      if (y - lastY < LABEL_GAP) continue;
      lastY = y;
      out.push({ key: s.key, text, top: s.top });
    }
    return out;
    // fractionOf changes with span alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, trackHeight, span, t]);

  // The days, one dot per pixel row of the track: of the days that land on
  // the same row only the fullest stands, so a library of thousands of days
  // is a few hundred dots. A row holding a month's first day is the month's.
  const dayDots = useMemo(() => {
    const monthRows = new Set(
      months.map((s) => Math.round(fractionOf(s.top) * trackHeight)),
    );
    const byRow = new Map<number, RailDay>();
    for (const d of days) {
      const row = Math.round(fractionOf(d.top) * trackHeight);
      if (monthRows.has(row)) continue;
      const held = byRow.get(row);
      if (!held || d.count > held.count) byRow.set(row, d);
    }
    return [...byRow.values()];
    // fractionOf changes with span alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, months, trackHeight, span]);

  /** The month holding a scroll offset: the last one starting at or before it. */
  const monthAt = (offset: number): RailMonth | null => {
    let found: RailMonth | null = null;
    for (const s of months) {
      if (s.top <= offset) found = s;
      else break;
    }
    return found ?? months[0] ?? null;
  };
  /** The day holding a scroll offset, or null in the undated tail. */
  const dayAt = (offset: number): RailDay | null => {
    let found: RailDay | null = null;
    for (const d of days) {
      if (d.top <= offset) found = d;
      else break;
    }
    const section = monthAt(offset);
    return section?.key === UNDATED ? null : (found ?? days[0] ?? null);
  };
  const chipFor = (offset: number): string | null => {
    const day = dayAt(offset);
    if (day)
      return t("timeline.day", {
        day: dayLabel(day.key, lang),
        count: day.count,
      });
    const section = monthAt(offset);
    return section ? label(section) : null;
  };

  /** The scroll offset under the pointer. */
  const offsetAtPointer = (e: { clientY: number }) => {
    const el = track.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const f = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
    return Math.min(1, Math.max(0, f)) * span;
  };

  // The pointer over the track, and whether it is dragging: the chip follows
  // it, and the list too while dragging.
  const [pointer, setPointer] = useState<{
    offset: number;
    dragging: boolean;
  } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const offset = offsetAtPointer(e);
    setPointer({ offset, dragging: true });
    onScrollTo(offset);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const offset = offsetAtPointer(e);
    const dragging = e.currentTarget.hasPointerCapture(e.pointerId);
    setPointer({ offset, dragging });
    if (dragging) onScrollTo(offset);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    setPointer((p) => (p ? { ...p, dragging: false } : p));
  };
  const onPointerLeave = () => setPointer((p) => (p?.dragging ? p : null));

  // The arrows walk the months, newest first; none of the keys may reach
  // the window, where the list's own key handling would take the same press.
  // Near the end of the list a step may not change the section at the top
  // (the list cannot scroll that far), so the steps are counted from the
  // last one taken until the list moves on its own.
  const currentIndex = Math.max(
    0,
    months.findIndex((s) => s.key === current),
  );
  const stepped = useRef<string | null>(null);
  useEffect(() => {
    stepped.current = null;
  }, [current]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const steppedIndex = months.findIndex((s) => s.key === stepped.current);
    const from = steppedIndex >= 0 ? steppedIndex : currentIndex;
    let next: number | null = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight")
      next = Math.min(months.length - 1, from + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft")
      next = Math.max(0, from - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = months.length - 1;
    else if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
      return;
    }
    if (next == null || months.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    stepped.current = months[next].key;
    if (next !== from) onJump(months[next].key);
  };

  const gripTop = fractionOf(scrollTop);
  // The chip sits by the grip while dragging (the two move together) and by
  // the pointer while it only hovers.
  const chipAt = pointer
    ? pointer.dragging
      ? scrollTop
      : pointer.offset
    : null;
  const chip = chipAt == null ? null : chipFor(chipAt);
  const currentSection = months[currentIndex];

  return (
    <nav
      aria-label={t("timeline.scrubber")}
      data-slot="timeline-scrubber"
      className="relative w-16 shrink-0 select-none"
    >
      {/* The bottom padding keeps the end of the track clear of the two
          round buttons floating over this corner. */}
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, months.length - 1)}
        aria-valuenow={currentIndex}
        aria-valuetext={currentSection ? label(currentSection) : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        className="absolute inset-x-0 bottom-40 top-3 cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RailMarks
          dayDots={dayDots}
          months={months}
          yearLabels={yearLabels}
          span={span}
        />
        {/* The grip: where the list is, with a line across the rail. */}
        <div
          aria-hidden
          data-slot="timeline-handle"
          className="pointer-events-none absolute inset-x-0 -translate-y-1/2"
          style={{ top: `${gripTop * 100}%` }}
        >
          <span className="absolute inset-x-1 top-1/2 h-px bg-fg/40" />
          <span
            className={cn(
              "absolute right-[9px] top-1/2 flex h-7 w-3.5 -translate-y-1/2 items-center justify-center rounded-full bg-fg text-bg shadow transition-colors",
              pointer?.dragging && "bg-primary text-primary-foreground",
            )}
          >
            <ChevronsUpDown className="size-3" />
          </span>
        </div>
        {/* The date under the pointer, or at the grip while dragging. */}
        {chipAt != null && chip && (
          <span
            data-slot="timeline-label"
            className="pointer-events-none absolute right-full top-0 mr-1 -translate-y-1/2 whitespace-nowrap rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow"
            style={{ top: `${fractionOf(chipAt) * 100}%` }}
          >
            {chip}
          </span>
        )}
      </div>
    </nav>
  );
});

/**
 * The dots and the years: the part of the rail that does not move with the
 * list. Drawn apart from the grip and the chip, which follow every scroll
 * frame and would otherwise have the hundreds of dots diffed each time.
 */
const RailMarks = memo(function RailMarks({
  dayDots,
  months,
  yearLabels,
  span,
}: {
  dayDots: RailDay[];
  months: RailMonth[];
  yearLabels: { key: string; text: string; top: number }[];
  span: number;
}) {
  const pct = (offset: number) =>
    `${Math.min(1, Math.max(0, offset / span)) * 100}%`;
  return (
    <>
      {/* One column of dots: a small one per day, a larger one per month. */}
      {dayDots.map((d) => (
        <span
          key={d.key}
          data-day={d.key}
          aria-hidden
          className="absolute right-[13px] size-1 -translate-y-1/2 rounded-full bg-fg/30"
          style={{ top: pct(d.top) }}
        />
      ))}
      {months.map((s) => (
        <span
          key={s.key}
          data-month={s.key}
          aria-hidden
          className={cn(
            "absolute right-3 size-1.5 -translate-y-1/2 rounded-full",
            s.key === UNDATED ? "bg-fg/35" : "bg-fg/60",
          )}
          style={{ top: pct(s.top) }}
        />
      ))}
      {yearLabels.map((y) => (
        <span
          key={y.key}
          data-year={y.text}
          aria-hidden
          className="absolute right-7 -translate-y-1/2 whitespace-nowrap text-[11px] leading-none text-fg/70"
          style={{ top: pct(y.top) }}
        >
          {y.text}
        </span>
      ))}
    </>
  );
});
