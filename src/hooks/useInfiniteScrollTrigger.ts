import { useEffect } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";

interface Options {
  virtualRows: VirtualItem[];
  totalRows: number;
  /** How many rows from the end to start the next-page fetch. */
  threshold: number;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  /** How many rows from the start to start the previous-page fetch. */
  prevThreshold?: number;
  hasPreviousPage?: boolean;
  isFetchingPreviousPage?: boolean;
  fetchPreviousPage?: () => void;
}

/** Trigger page fetches once virtualized rows near either edge become visible. */
export function useInfiniteScrollTrigger({
  virtualRows,
  totalRows,
  threshold,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  prevThreshold = 2,
  hasPreviousPage,
  isFetchingPreviousPage,
  fetchPreviousPage,
}: Options): void {
  useEffect(() => {
    const first = virtualRows[0];
    if (
      first &&
      first.index <= prevThreshold &&
      hasPreviousPage &&
      !isFetchingPreviousPage
    ) {
      fetchPreviousPage?.();
    }

    const last = virtualRows[virtualRows.length - 1];
    if (!last) return;
    if (
      last.index >= totalRows - threshold &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage?.();
    }
  }, [
    virtualRows,
    totalRows,
    threshold,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    prevThreshold,
    hasPreviousPage,
    isFetchingPreviousPage,
    fetchPreviousPage,
  ]);
}
