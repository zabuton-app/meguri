// The filter the list queries run on: the one in the filter bar, with its free
// text held back until the user pauses typing.
//
// Every keystroke used to change the query key of the file search (and of the
// timeline counts and the heatmap beside it), so a word typed into the box sent
// one search per letter to the single query worker, and each answer swapped
// the whole list on screen for the next. The box itself still follows every
// keystroke: only what is queried waits.
//
// Only a change of the text alone waits. A change that also moves anything
// else (a saved search applied, "Clear all") is taken at once, text included:
// holding its text back would query the new conditions with the old text, a
// list nobody asked for.
import { useEffect, useMemo, useState } from "react";
import { hashKey } from "@tanstack/react-query";
import type { SearchQuery } from "@/ipc/types";

/** How long the search text has to stay unchanged before it is queried. */
export const QUERY_TEXT_SETTLE_MS = 200;

/** Everything about a filter except its free text, comparable by value. */
function restKeyOf(filter: SearchQuery): string {
  return hashKey([{ ...filter, q: undefined }]);
}

export function useSettledFilter(filter: SearchQuery): SearchQuery {
  const restKey = restKeyOf(filter);
  const [settled, setSettled] = useState({ text: filter.q, restKey });
  if (settled.restKey !== restKey) {
    // React's "adjust state when a prop changes" pattern: the render restarts
    // with the text settled before anything is committed.
    setSettled({ text: filter.q, restKey });
  }
  const settledText = settled.restKey === restKey ? settled.text : filter.q;

  useEffect(() => {
    if (filter.q === settledText) return;
    const timer = window.setTimeout(
      () => setSettled((s) => ({ ...s, text: filter.q })),
      QUERY_TEXT_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [filter.q, settledText]);

  const caughtUp = filter.q === settledText;
  // Caught up, the filter itself, so its identity (and every query key and
  // memo built from it) is the same as if the text had never lagged. Lagging,
  // one object for as long as only the text moves: the filter bar hands a new
  // filter on every keystroke, and the memoized views below take this by
  // identity.
  return useMemo(
    () => (caughtUp ? filter : { ...filter, q: settledText }),
    // `filter` only matters once caught up; while lagging the rest of it is
    // pinned by restKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caughtUp ? filter : restKey, settledText],
  );
}
