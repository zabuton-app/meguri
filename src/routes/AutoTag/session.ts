// What the user has decided on the auto-tagging screen since opening it — kept
// above the tabs, because a tab unmounts when another is shown and none of this
// may go with it: least of all the handles that take an apply back.
import { useMemo, useState } from "react";
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
  /** Review tab: files confirmed, by position. */
  confirmed: Set<number>;
  /** Review tab: proposals switched off per file (lowercased tags). */
  removed: Map<number, Set<string>>;
  /** Review tab: tags added by hand per file. */
  added: Map<number, string[]>;
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
  confirmed: new Set(),
  removed: new Map(),
  added: new Map(),
  overrides: new Map(),
});

/**
 * `generation` changes whenever the file list is loaded again. Everything here
 * is keyed by position in that list, so a new list starts a new session rather
 * than letting old positions point at whatever sits there now.
 */
export function useAutoTagSession(generation: number): AutoTagSession {
  const [state, setState] = useState({ generation, data: empty() });
  if (state.generation !== generation) {
    setState({ generation, data: empty() });
  }
  const data = state.generation === generation ? state.data : empty();
  const setters = useMemo(() => {
    const set =
      <K extends keyof SessionData>(key: K) =>
      (value: SessionData[K]) =>
        setState((prev) => ({ ...prev, data: { ...prev.data, [key]: value } }));
    return {
      setDone: set("done"),
      setConfirmed: set("confirmed"),
      setRemoved: set("removed"),
      setAdded: set("added"),
      setOverrides: set("overrides"),
    };
  }, []);
  return { ...data, ...setters };
}
