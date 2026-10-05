// The handles that take back what was applied from the auto-tagging screen —
// kept above the tabs, because a tab unmounts when another is shown and these
// may not go with it. They also outlive the screen itself (see `remembered`),
// for as long as the file list is the same.
import { useEffect, useMemo, useState } from "react";
import type { UndoHandle } from "./useAutoTag";

interface SessionData {
  /**
   * Suggestions tab: candidate key → how to take back the tags applied for it
   * here. Only that: what a row says (applied, in the keywords) is read from
   * the files and the configuration, never from a note kept on the side.
   */
  undos: Map<string, UndoHandle>;
}

export type AutoTagSession = SessionData & {
  [K in keyof SessionData as `set${Capitalize<K>}`]: (
    value: SessionData[K],
  ) => void;
};

const empty = (): SessionData => ({
  undos: new Map(),
});

/**
 * The last session, kept after the screen is gone so that reopening it — after
 * searching the library from it, say — can still take back what was applied.
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
      setUndos: set("undos"),
    };
  }, []);
  return { ...data, ...setters };
}
