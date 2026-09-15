// What every Home layout receives: the shelves' data and the actions the
// route offers. A layout arranges these (and owns its keyboard order); it
// never fetches or navigates on its own, so layouts stay interchangeable.
import type { ShelfData } from "../useHomeShelves";

export interface HomeLayoutProps {
  recent: ShelfData;
  picks: ShelfData;
  /** Files most recently played, newest first, each once. */
  played: ShelfData;
  mediaBase: string;
  /** workspaceId:id → update counter (thumb:done cache buster), as in the grid. */
  thumbVersion: Record<string, number>;
  /** "See all" on Recently added: the "All" list sorted the same way. */
  onSeeAllRecent: () => void;
  /** "See all" on Recently played: the play history screen. */
  onSeeAllPlayed: () => void;
  onOpenDiscover: () => void;
  onReshufflePicks: () => void;
  /** A tag on a card: filter the library by it (the list shows it). */
  onTagClick?: (token: string) => void;
  /** Whether the view is foreground (no modal / overlay on top). */
  navActive: boolean;
}
