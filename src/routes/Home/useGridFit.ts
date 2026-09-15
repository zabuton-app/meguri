// How many cards a Home grid shows: beside a stage, as many as fit its
// height (useSideFit); on a single-row shelf, one per column (useSingleRow).
// Shared by the Home layouts.
import { useLayoutEffect, useMemo, useState } from "react";
import type { FileRow } from "@/ipc/types";

/** Columns a CSS grid lays out, from its resolved track list (0: unknown). */
function gridColumnCount(grid: Element): number {
  const tracks = getComputedStyle(grid).gridTemplateColumns.trim();
  return tracks && tracks !== "none" ? tracks.split(/\s+/).length : 0;
}

/**
 * The grid beside the hero may run this much of a card past the hero's
 * height: a second (or third) row that only just overshoots still shows,
 * which reads better than a lone row beside a tall picture.
 */
const SIDE_SLACK_CARDS = 0.5;

/**
 * How many cards the grid beside the hero shows: its column count times the
 * rows that fit in the hero's height plus the slack above. Everything is
 * measured (the grid's resolved tracks, a card's height, the row gap, the
 * hero's box) and re-measured as either resizes. 0 until known (jsdom has no
 * layout; a 0 means "show everything").
 */
export function useSideFit(): {
  fit: number;
  attachHero: (el: HTMLDivElement | null) => void;
  attachGrid: (el: HTMLDivElement | null) => void;
} {
  const [hero, setHero] = useState<HTMLDivElement | null>(null);
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(0);
  // Measured before paint, so the grid never shows every card for a frame.
  useLayoutEffect(() => {
    if (!hero || !grid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFit(0);
      return;
    }
    const measure = () => {
      const style = getComputedStyle(grid);
      const columns = gridColumnCount(grid);
      const card = grid.firstElementChild;
      const cardHeight = card?.getBoundingClientRect().height ?? 0;
      const heroHeight = hero.getBoundingClientRect().height;
      if (columns === 0 || cardHeight === 0 || heroHeight === 0) {
        setFit(0);
        return;
      }
      const gap = parseFloat(style.rowGap) || 0;
      // n rows take n * card + (n - 1) * gap; at least one row shows.
      const room = heroHeight + gap + SIDE_SLACK_CARDS * cardHeight;
      const rows = Math.max(1, Math.floor(room / (cardHeight + gap)));
      setFit(rows * columns);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(hero);
    ro.observe(grid);
    if (grid.firstElementChild) ro.observe(grid.firstElementChild);
    return () => ro.disconnect();
  }, [hero, grid]);
  return { fit, attachHero: setHero, attachGrid: setGrid };
}

/**
 * How many columns a CSS grid lays out, from its resolved track list,
 * re-measured as it resizes. A single-row shelf shows this many cards. 0
 * until known (jsdom has no layout; a 0 means "show everything").
 */
export function useGridColumns(): {
  columns: number;
  attachGrid: (el: HTMLDivElement | null) => void;
} {
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(0);
  // Measured before paint, so the row never shows every card for a frame.
  useLayoutEffect(() => {
    if (!grid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setColumns(0);
      return;
    }
    const measure = () => setColumns(gridColumnCount(grid));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [grid]);
  return { columns, attachGrid: setGrid };
}

/**
 * A single-row shelf: the files cut to as many as its grid has columns, and
 * the callback that attaches the grid. Spread into a layout's row entry.
 */
export function useSingleRow(files: FileRow[]): {
  files: FileRow[];
  attachGrid: (el: HTMLDivElement | null) => void;
} {
  const { columns, attachGrid } = useGridColumns();
  const shown = useMemo(
    () => (columns === 0 ? files : files.slice(0, columns)),
    [files, columns],
  );
  return useMemo(() => ({ files: shown, attachGrid }), [shown, attachGrid]);
}
