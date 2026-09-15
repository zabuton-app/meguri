// Everything Home needs to put the landing shelves above its list (issue
// #123): when they show, their data, the remembered collapsed state, and the
// keyboard focus handoff between the shelves and the list. Home only mounts
// the returned element and forwards the list-side handles to its views.
import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { COLLECTION_ID_PREFIX } from "@/ipc/client";
import type { SearchQuery } from "@/ipc/types";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { usePreferences } from "@/settings/PreferencesProvider";
import { HomeLanding } from "./HomeLanding";
import { useHomeShelves } from "./useHomeShelves";
import {
  LANDING_COLLAPSED_KEY,
  RECENT_SORT,
  isLandingEligible,
} from "./landing";

interface Options {
  filter: SearchQuery;
  setFilter: Dispatch<SetStateAction<SearchQuery>>;
  /** A user collection (or Watch Later) is the active view. */
  collectionActive: boolean;
  /** app_status: the active workspace / collection id, and readiness. */
  workspaceId: string | null | undefined;
  ready: boolean;
  /** The list's first page is in; the shelves never load ahead of it. */
  listLoaded: boolean;
  /** Offset of the list's first loaded row; the shelves sit above row 0 only. */
  listOffset: number;
  mediaBase: string;
  thumbVersion: Record<string, number>;
  /** The list screen is foreground (no overlay / route on top). */
  navActive: boolean;
  openDiscover: () => void;
}

export interface HomeLandingHandles {
  /** The shelves, or undefined while there is nothing to show. */
  element: ReactNode | undefined;
  /** Whether the list owns the arrow keys right now. */
  listNavActive: boolean;
  /** For the list views: up from the first row hands focus to the shelves. */
  onListExitTop: (() => void) | undefined;
  /** For the list views: bumped when focus comes back down from the shelves. */
  listEnterToken: number;
  /** After a scan lands: refresh the shelves. Stable. */
  refreshAfterScan: () => void;
}

export function useHomeLanding({
  filter,
  setFilter,
  collectionActive,
  workspaceId,
  ready,
  listLoaded,
  listOffset,
  mediaBase,
  thumbVersion,
  navActive,
  openDiscover,
}: Options): HomeLandingHandles {
  const { homeLanding } = usePreferences();

  // Only over the plain library: no search / filter, and no collection. The
  // collection check reads both the workspace list and app_status, since a
  // switch refreshes them one after the other and either may be ahead.
  const eligible =
    homeLanding &&
    isLandingEligible(filter, collectionActive) &&
    !(workspaceId ?? "").startsWith(COLLECTION_ID_PREFIX);
  const shelves = useHomeShelves(workspaceId, ready && eligible && listLoaded);
  const visible =
    eligible && (shelves.recent.length > 0 || shelves.picks.length > 0);

  const [collapsed, setCollapsed] = useLocalStorage<boolean>(
    LANDING_COLLAPSED_KEY,
    false,
    (raw) => raw === "true",
  );
  const toggleCollapsed = useCallback(
    () => setCollapsed((c) => !c),
    [setCollapsed],
  );
  const onSeeAllRecent = useCallback(
    () => setFilter((f) => ({ ...f, ...RECENT_SORT })),
    [setFilter],
  );

  // Which block owns the arrow keys: the list (default) or the shelves above
  // it. Each hands over at its edge (up from the list's first row, down from
  // the last shelf) by bumping the other's enter token.
  const [navRegion, setNavRegion] = useState<"list" | "landing">("list");
  const [listEnterToken, setListEnterToken] = useState(0);
  const [landingEnterToken, setLandingEnterToken] = useState(0);
  const navigable = visible && !collapsed;
  // Once the shelves go away (filter, collapse, empty) the list takes the keys
  // for good; when they come back nothing hands focus up without a key press.
  const [wasNavigable, setWasNavigable] = useState(navigable);
  if (wasNavigable !== navigable) {
    setWasNavigable(navigable);
    if (!navigable) setNavRegion("list");
  }
  const region = navigable ? navRegion : "list";
  const onListExitTop = useCallback(() => {
    setNavRegion("landing");
    setLandingEnterToken((n) => n + 1);
  }, []);
  const onLandingExitBottom = useCallback(() => {
    setNavRegion("list");
    setListEnterToken((n) => n + 1);
  }, []);

  // Memoized: the list views are memo'd on their props, and Home re-renders
  // on every thumbnail flush.
  const landingNavActive = navActive && region === "landing";
  const element = useMemo(
    () =>
      visible ? (
        <HomeLanding
          recent={shelves.recent}
          picks={shelves.picks}
          mediaBase={mediaBase}
          thumbVersion={thumbVersion}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onSeeAllRecent={onSeeAllRecent}
          onOpenDiscover={openDiscover}
          onReshufflePicks={shelves.reshufflePicks}
          picksFetching={shelves.picksFetching}
          navActive={landingNavActive}
          enterToken={landingEnterToken}
          onExitBottom={onLandingExitBottom}
        />
      ) : undefined,
    [
      visible,
      shelves.recent,
      shelves.picks,
      shelves.reshufflePicks,
      shelves.picksFetching,
      mediaBase,
      thumbVersion,
      collapsed,
      toggleCollapsed,
      onSeeAllRecent,
      openDiscover,
      landingNavActive,
      landingEnterToken,
      onLandingExitBottom,
    ],
  );

  return {
    element,
    listNavActive: navActive && region === "list",
    // Only when the list's first loaded row really is the top: with earlier
    // pages evicted, "up" from the first loaded row has rows to reach first.
    onListExitTop: navigable && listOffset === 0 ? onListExitTop : undefined,
    listEnterToken,
    refreshAfterScan: shelves.refreshAfterScan,
  };
}
