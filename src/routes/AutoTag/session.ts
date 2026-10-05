// What the user has decided on the auto-tagging screen — kept above the tabs,
// because a tab unmounts when another is shown and none of this may go with
// it: least of all the handles that take an apply back. It also outlives the
// screen itself (see `remembered`), for as long as the file list is the same.
import { useEffect, useMemo, useState } from "react";
import type { UndoHandle } from "./useAutoTag";

/** A suggestion applied in this visit, and how to take it back. */
export interface SuggestDone {
  dict: boolean;
  undo: UndoHandle | null;
}

/** Where a term's decision came from when the user did not make it. */
export type TermOrigin = "dictionary" | "rule";

export interface TermDecision {
  target: string;
  origin?: TermOrigin;
}

interface SessionData {
  /** Suggestions tab: candidate key → what was done with it. */
  done: Map<string, SuggestDone>;
  /** Terms tab: decisions made here; null puts a term back to undecided. */
  overrides: Map<string, TermDecision | null>;
}

export type AutoTagSession = SessionData & {
  [K in keyof SessionData as `set${Capitalize<K>}`]: (
    value: SessionData[K],
  ) => void;
};

const empty = (): SessionData => ({
  done: new Map(),
  overrides: new Map(),
});

/**
 * The last session, kept after the screen is gone so that reopening it — after
 * searching the library from it, say — finds the same decisions and the same
 * undo.
 */
let remembered: { listKey: string; data: SessionData } | null = null;

/** Forget the remembered session. Tests start each case without one. */
export function resetAutoTagSession(): void {
  remembered = null;
}

const sessionFor = (listKey: string | null) => ({
  listKey,
  data:
    listKey !== null && remembered?.listKey === listKey
      ? remembered.data
      : empty(),
});

/**
 * `listKey` identifies the list of files the screen has loaded (null while it
 * has none). The undo handles kept here name files by position in that list, so
 * the session lasts exactly as long as the list reads the same: a list that
 * changed starts a new one rather than letting old positions point at whatever
 * sits there now.
 */
export function useAutoTagSession(listKey: string | null): AutoTagSession {
  const [state, setState] = useState(() => sessionFor(listKey));
  if (state.listKey !== listKey) setState(sessionFor(listKey));
  const data =
    state.listKey === listKey ? state.data : sessionFor(listKey).data;
  useEffect(() => {
    if (state.listKey !== null) {
      remembered = { listKey: state.listKey, data: state.data };
    }
  }, [state]);
  const setters = useMemo(() => {
    const set =
      <K extends keyof SessionData>(key: K) =>
      (value: SessionData[K]) =>
        setState((prev) => ({ ...prev, data: { ...prev.data, [key]: value } }));
    return {
      setDone: set("done"),
      setOverrides: set("overrides"),
    };
  }, []);
  return { ...data, ...setters };
}
