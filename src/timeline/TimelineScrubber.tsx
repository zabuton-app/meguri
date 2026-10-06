// The timeline's rail, a minimap of the list: the whole list at the height
// of the view, the years written along it and a bar per month as long and as
// dark as the month is full. A window on it shows the part of the list on
// screen; dragging the window, or pressing anywhere on the track, scrolls
// the list there while a label names the month under the pointer. From the
// keyboard it is a slider over the months: the arrows move the list a month
// at a time.
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
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { levelOf } from "@/heatmap/calendar";
import { UNDATED } from "./layout";
import { monthLabel, yearOf } from "./dates";

/** Bar fill per level (see levelOf; the heatmap's shades). */
const LEVEL_CLASS = [
  "bg-fg/10",
  "bg-primary/30",
  "bg-primary/55",
  "bg-primary/80",
  "bg-primary",
];

/** Pixels two year labels must be apart to both be written. */
const LABEL_GAP = 18;

/** One section of the list as the rail sees it: where it starts and its size. */
export interface RailSection {
  /** "YYYY-MM", or UNDATED for the tail. */
  key: string;
  count: number;
  /** Scroll offset of the section's header. */
  top: number;
}

interface Props {
  sections: RailSection[];
  /** The list's whole height, and the height of the view onto it. */
  totalSize: number;
  viewHeight: number;
  scrollTop: number;
  /** Key of the section at the top of the list. */
  current: string | null;
  /** Scrolls the list to an offset (dragging, pressing the track). */
  onScrollTo: (offset: number) => void;
  /** Scrolls the list to a section's header (the keyboard). */
  onJump: (key: string) => void;
}

export const TimelineScrubber = memo(function TimelineScrubber({
  sections,
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

  const span = Math.max(1, totalSize);
  const maxScroll = Math.max(0, totalSize - viewHeight);
  /** Where on the track (0..1) an offset into the list sits. */
  const fractionOf = (offset: number) =>
    Math.min(1, Math.max(0, offset / span));

  const label = useCallback(
    (section: RailSection) =>
      t("timeline.month", {
        month:
          section.key === UNDATED
            ? t("timeline.undated")
            : monthLabel(section.key, lang),
        count: section.count,
      }),
    [t, lang],
  );

  const max = sections.reduce((n, s) => Math.max(n, s.count), 0);
  // A year is written at its newest month; one too close to the year above
  // it on the track is left out, and the undated tail is named like a year.
  const yearLabels = useMemo(() => {
    const out: { key: string; text: string; top: number }[] = [];
    let seen = "";
    let lastY = -Infinity;
    for (const s of sections) {
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
  }, [sections, trackHeight, span, t]);

  /** The section holding a scroll offset: the last one starting at or before it. */
  const sectionAt = (offset: number): RailSection | null => {
    let found: RailSection | null = null;
    for (const s of sections) {
      if (s.top <= offset) found = s;
      else break;
    }
    return found ?? sections[0] ?? null;
  };

  /** The offset into the list under the pointer. */
  const offsetAtPointer = (e: { clientY: number }) => {
    const el = track.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const f = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
    return Math.min(1, Math.max(0, f)) * span;
  };
  /** The scroll that puts the pointed offset in the middle of the view. */
  const scrollFor = (offset: number) =>
    Math.min(maxScroll, Math.max(0, offset - viewHeight / 2));

  // The pointer over the track, and whether it is dragging: the label follows
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
    onScrollTo(scrollFor(offset));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const offset = offsetAtPointer(e);
    const dragging = e.currentTarget.hasPointerCapture(e.pointerId);
    setPointer({ offset, dragging });
    if (dragging) onScrollTo(scrollFor(offset));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    setPointer((p) => (p ? { ...p, dragging: false } : p));
  };
  const onPointerLeave = () => setPointer((p) => (p?.dragging ? p : null));

  // The arrows walk the sections, newest first; none of the keys may reach
  // the window, where the list's own key handling would take the same press.
  // Near the end of the list a step may not change the section at the top
  // (the list cannot scroll that far), so the steps are counted from the
  // last one taken until the list moves on its own.
  const currentIndex = Math.max(
    0,
    sections.findIndex((s) => s.key === current),
  );
  const stepped = useRef<string | null>(null);
  useEffect(() => {
    stepped.current = null;
  }, [current]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const steppedIndex = sections.findIndex((s) => s.key === stepped.current);
    const from = steppedIndex >= 0 ? steppedIndex : currentIndex;
    let next: number | null = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight")
      next = Math.min(sections.length - 1, from + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft")
      next = Math.max(0, from - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = sections.length - 1;
    else if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
      return;
    }
    if (next == null || sections.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    stepped.current = sections[next].key;
    if (next !== from) onJump(sections[next].key);
  };

  const shown = pointer ? sectionAt(pointer.offset) : null;
  const windowTop = fractionOf(scrollTop);
  const windowHeight = Math.max(
    0.01,
    fractionOf(scrollTop + viewHeight) - windowTop,
  );
  const currentSection = sections[currentIndex];

  return (
    <nav
      aria-label={t("timeline.scrubber")}
      data-slot="timeline-scrubber"
      className="relative w-20 shrink-0 select-none border-l border-border"
    >
      {/* The bottom padding keeps the end of the track clear of the two
          round buttons floating over this corner. */}
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, sections.length - 1)}
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
        {/* A bar per month, where it sits on the track, as long and as dark
            as the month is full. */}
        {sections.map((s) => (
          <span
            key={s.key}
            data-month={s.key}
            aria-hidden
            className={cn(
              "absolute left-1/2 h-0.5 -translate-x-1/2 rounded-full",
              LEVEL_CLASS[s.key === UNDATED ? 1 : levelOf(s.count, max)],
            )}
            style={{
              top: `${fractionOf(s.top) * 100}%`,
              width: `${s.key === UNDATED ? 6 : 6 + 26 * Math.sqrt(s.count / Math.max(1, max))}px`,
            }}
          />
        ))}
        {yearLabels.map((y) => (
          <span
            key={y.key}
            data-year={y.text}
            aria-hidden
            className="absolute right-[calc(50%+0.75rem)] -translate-y-1/2 whitespace-nowrap text-[10px] leading-none text-muted"
            style={{ top: `${fractionOf(y.top) * 100}%` }}
          >
            {y.text}
          </span>
        ))}
        {/* The window: the part of the list on screen. */}
        <span
          aria-hidden
          data-slot="timeline-handle"
          className={cn(
            "absolute left-1/2 w-10 -translate-x-1/2 rounded-sm border border-fg/25 bg-fg/10 transition-colors",
            pointer?.dragging && "border-primary/60 bg-primary/20",
          )}
          style={{
            top: `${windowTop * 100}%`,
            height: `${windowHeight * 100}%`,
          }}
        />
        {/* The month under the pointer, beside it. */}
        {pointer && shown && (
          <span
            data-slot="timeline-label"
            className="pointer-events-none absolute right-full top-0 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg shadow"
            style={{ top: `${fractionOf(pointer.offset) * 100}%` }}
          >
            {label(shown)}
          </span>
        )}
      </div>
    </nav>
  );
});
