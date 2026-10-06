// One page of a long list at a time. A list here can run to thousands of rows
// (every candidate word in the library); drawing them all would stall the
// screen, and cutting the list off left the rest out of reach.
import { MAX_ROWS } from "./helpers";
import { useViewState } from "./viewState";

export interface Paging {
  /** Zero-based, and always a page that exists. */
  page: number;
  pages: number;
  /** The rows of this page: `list.slice(start, end)`. */
  start: number;
  end: number;
  total: number;
  setPage: (page: number) => void;
}

/**
 * The page a list is on, remembered under `key` like the rest of the screen's
 * view state. `scope` names what the list is showing (its filter, its search):
 * a different scope is a different list, and starts at its first page.
 */
export function usePaging(key: string, scope: string, total: number): Paging {
  const [at, setAt] = useViewState(key, { scope, page: 0 });
  const pages = Math.max(1, Math.ceil(total / MAX_ROWS));
  // Clamped: rows leave a list as they are dealt with, and the last page can
  // empty out under the user.
  const page = at.scope === scope ? Math.min(at.page, pages - 1) : 0;
  const start = page * MAX_ROWS;
  return {
    page,
    pages,
    start,
    end: Math.min(start + MAX_ROWS, total),
    total,
    setPage: (next) =>
      setAt({ scope, page: Math.max(0, Math.min(next, pages - 1)) }),
  };
}
