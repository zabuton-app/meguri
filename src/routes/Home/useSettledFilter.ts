// The filter the list queries run on: the one in the filter bar, with its free
// text held back until the user pauses typing.
//
// Every keystroke used to change the query key of the file search (and of the
// timeline counts and the heatmap beside it), so a word typed into the box sent
// one search per letter to the single query worker, and each answer swapped
// the whole list on screen for the next. The box itself still follows every
// keystroke: only what is queried waits.
import { useEffect, useMemo, useState } from "react";
import type { SearchQuery } from "@/ipc/types";

/** How long the search text has to stay unchanged before it is queried. */
export const QUERY_TEXT_SETTLE_MS = 200;

export function useSettledFilter(
  filter: SearchQuery,
  delay = QUERY_TEXT_SETTLE_MS,
): SearchQuery {
  const [settledText, setSettledText] = useState(filter.q);
  useEffect(() => {
    if (filter.q === settledText) return;
    const timer = window.setTimeout(() => setSettledText(filter.q), delay);
    return () => window.clearTimeout(timer);
  }, [filter.q, settledText, delay]);
  // The filter itself once the text has caught up, so its identity (and every
  // query key built from it) is the same as before the text ever lagged.
  return useMemo(
    () => (filter.q === settledText ? filter : { ...filter, q: settledText }),
    [filter, settledText],
  );
}
