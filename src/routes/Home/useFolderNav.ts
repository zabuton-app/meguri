// Where the folder view is, per workspace, and how it got there.
//
// Held in memory rather than in the URL: the detail, settings and other
// screens are child routes drawn over Home, which stays mounted underneath, so
// state kept here survives opening and closing them untouched — while a
// "?folder=" on "/" would be dropped by the first navigate to "/file/:id".
// The last local path is restored after restart; back history stays session-local.
import { useCallback, useMemo, useRef, useState } from "react";
import { ROOT_FOLDER, parentOf } from "@shared/folderPath";
import { readLibraryLocation } from "@/hooks/useLibraryLocation";

/** How many steps "back" remembers per workspace. */
export const FOLDER_BACK_LIMIT = 100;

interface Entry {
  path: string;
  /** Earlier locations, most recent last. */
  back: string[];
}

const START: Entry = { path: ROOT_FOLDER, back: [] };

export interface FolderNav {
  /** The folder being shown ("" is the workspace root). */
  path: string;
  canGoBack: boolean;
  /** Open a child folder (or any folder): remembered for "back". */
  enter: (path: string) => void;
  /** Jump to a folder, e.g. from the breadcrumb: remembered for "back". */
  goTo: (path: string) => void;
  /** Return to where the previous move started from. */
  goBack: () => void;
  /** One level up. Does nothing at the root. */
  goUp: () => void;
  /**
   * Swap the location without a history step: the folder shown is gone and
   * the main process resolved its nearest remaining ancestor.
   */
  replace: (path: string) => void;
  /**
   * Jump to a folder of any workspace, e.g. from a file's detail or a saved
   * search: remembered for "back" in that workspace. The workspace itself is
   * switched by the caller.
   */
  visit: (workspaceId: string, path: string) => void;
  /**
   * How many moves the user has made (enter, goTo, goBack, goUp; not replace
   * or visit). A request that resolves later compares it to tell whether the
   * user has moved on meanwhile.
   */
  moves: () => number;
}

export function useFolderNav(
  workspaceId: string | null | undefined,
): FolderNav {
  const [byWorkspace, setByWorkspace] = useState<Record<string, Entry>>(() => {
    const saved = readLibraryLocation();
    return saved ? { [saved.workspaceId]: { path: saved.path, back: [] } } : {};
  });
  const key = workspaceId ?? "";
  const entry = byWorkspace[key] ?? START;
  const moveCount = useRef(0);
  const moves = useCallback(() => moveCount.current, []);

  const apply = useCallback(
    (fn: (e: Entry) => Entry) =>
      setByWorkspace((all) => {
        const current = all[key] ?? START;
        const next = fn(current);
        return next === current ? all : { ...all, [key]: next };
      }),
    [key],
  );
  // A user's move: counted (see `moves`) outside the updater, which StrictMode
  // may run twice.
  const update = useCallback(
    (fn: (e: Entry) => Entry) => {
      moveCount.current++;
      apply(fn);
    },
    [apply],
  );

  const move = useCallback(
    (path: string) =>
      update((e) =>
        e.path === path
          ? e
          : {
              path,
              back: [...e.back, e.path].slice(-FOLDER_BACK_LIMIT),
            },
      ),
    [update],
  );

  const goBack = useCallback(
    () =>
      update((e) =>
        e.back.length === 0
          ? e
          : { path: e.back[e.back.length - 1], back: e.back.slice(0, -1) },
      ),
    [update],
  );

  const goUp = useCallback(
    () =>
      update((e) =>
        e.path === ROOT_FOLDER
          ? e
          : {
              path: parentOf(e.path),
              back: [...e.back, e.path].slice(-FOLDER_BACK_LIMIT),
            },
      ),
    [update],
  );

  const visit = useCallback(
    (workspaceId: string, path: string) =>
      setByWorkspace((all) => {
        const current = all[workspaceId] ?? START;
        if (current.path === path) return all;
        return {
          ...all,
          [workspaceId]: {
            path,
            back: [...current.back, current.path].slice(-FOLDER_BACK_LIMIT),
          },
        };
      }),
    [],
  );

  // The ancestor stepped back to may be where "back" would lead anyway (a
  // folder entered from its parent, then gone): drop those steps so "back"
  // never lands on the folder already shown.
  const replace = useCallback(
    (path: string) =>
      apply((e) => {
        if (e.path === path) return e;
        let end = e.back.length;
        while (end > 0 && e.back[end - 1] === path) end--;
        return { path, back: e.back.slice(0, end) };
      }),
    [apply],
  );

  return useMemo(
    () => ({
      path: entry.path,
      canGoBack: entry.back.length > 0,
      enter: move,
      goTo: move,
      goBack,
      goUp,
      replace,
      visit,
      moves,
    }),
    [entry, move, goBack, goUp, replace, visit, moves],
  );
}
