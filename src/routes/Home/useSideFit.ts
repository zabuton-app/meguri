// How many cards a grid beside the hero can show without running much past
// the hero's height. Shared by any Home layout that puts a card grid beside
// a stage.
import { useEffect, useState } from "react";

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
  useEffect(() => {
    if (!hero || !grid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFit(0);
      return;
    }
    const measure = () => {
      const style = getComputedStyle(grid);
      const tracks = style.gridTemplateColumns.trim();
      const columns = tracks ? tracks.split(/\s+/).length : 0;
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
