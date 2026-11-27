import { useEffect, useRef } from "react";

/**
 * Scrolls a view of the list to the file the docked side peek shows, once
 * per file, as soon as the view is `ready` (loaded, and laid out for its
 * current width). Not again on later renders (paging, a resize): that would
 * fight the user's own scrolling, and a file paged in later is not worth a
 * jump either.
 *
 * `row` is the view's row of the peek's file, or -1 when the view does not
 * hold it. `ready` is read inside the effect, so it may read the layout; a
 * new `ready` is what makes the effect check again, so it must change
 * identity whenever its answer can change (a `useCallback` over what it reads).
 */
export function useScrollToPeek({
  peekFileKey,
  row,
  ready,
  scrollToRow,
}: {
  peekFileKey: string | undefined;
  row: number;
  ready: () => boolean;
  scrollToRow: (row: number) => void;
}) {
  const scrolledToPeek = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!peekFileKey) {
      scrolledToPeek.current = undefined;
      return;
    }
    if (scrolledToPeek.current === peekFileKey || !ready()) return;
    scrolledToPeek.current = peekFileKey;
    if (row >= 0) scrollToRow(row);
  }, [peekFileKey, row, ready, scrollToRow]);
}
