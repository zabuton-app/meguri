// Shares the active list ordering (and its pagination controls) from the list
// screen (Home) down to the detail modal, so the detail can navigate to the
// previous/next file following the exact order/filter the user is browsing.
import { createContext, useContext } from "react";
import type { FileRow } from "@/ipc/types";

export interface MediaNav {
  /** The currently loaded list items, in display order. */
  items: FileRow[];
  /** Global index offset of items[0] within the full filtered result set. */
  listOffset: number;
  /** Load the next page (used when navigating past the loaded tail). */
  fetchNextPage: () => void;
  /** Whether more pages exist beyond what is loaded. */
  hasNextPage: boolean;
  /** Whether a next-page fetch is in flight. */
  isFetchingNextPage: boolean;
  /** Load the previous page (used when navigating before the loaded head). */
  fetchPreviousPage: () => void;
  /** Whether earlier pages exist before what is loaded. */
  hasPreviousPage: boolean;
  /** Whether a previous-page fetch is in flight. */
  isFetchingPreviousPage: boolean;
}

const MediaNavContext = createContext<MediaNav | null>(null);

export const MediaNavProvider = MediaNavContext.Provider;

/** Returns the list navigation context, or null when none is mounted. */
export function useMediaNav(): MediaNav | null {
  return useContext(MediaNavContext);
}
