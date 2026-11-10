// Saving a file's note as the user types (NoteCard). The note is written here
// rather than through useDetailMutations: a write per pause in typing, queued
// and flushed when the card goes, does not fit a mutation per action.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import log from "@/lib/logger";
import { api } from "@/ipc/client";
import { patchFileDetailInCache } from "@/lib/queryCache";
import { normalizeNote } from "@shared/note";

/** How long typing has to pause before the note is written. */
export const SAVE_DELAY_MS = 1000;

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Writes the note for one file. Writes run one at a time; text typed while one
 * is in flight is written right after it, so the last text always lands last.
 * A failed write keeps the text for the next attempt.
 */
export function useNoteWriter(
  fileId: number,
  wsId: string,
  initial: string | null,
) {
  const qc = useQueryClient();
  /** What the database holds, as far as this view knows. */
  const saved = useRef(normalizeNote(initial));
  /** Text waiting to be written; undefined when there is none. */
  const pending = useRef<string | null | undefined>(undefined);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<SaveState>("idle");

  const write = useCallback(async () => {
    clearTimeout(timer.current);
    if (inFlight.current) return;
    let wrote = false;
    while (pending.current !== undefined) {
      const value = pending.current;
      pending.current = undefined;
      if (value === saved.current) continue;
      inFlight.current = true;
      setState("saving");
      try {
        await api.fileSetNote(fileId, wsId, value);
        saved.current = value;
        wrote = true;
        patchFileDetailInCache(qc, wsId, fileId, { note: value });
      } catch (e) {
        log.warn("could not save the note:", e);
        // Newer text typed meanwhile wins; otherwise retry this one.
        if (pending.current === undefined) pending.current = value;
        inFlight.current = false;
        setState("error");
        return;
      }
      inFlight.current = false;
    }
    // Nothing left to write: a failure shown earlier no longer applies (the
    // text was taken back to what is saved, say).
    setState((s) => (wrote ? "saved" : s === "error" ? "idle" : s));
  }, [fileId, wsId, qc]);

  const schedule = useCallback(
    (value: string | null) => {
      pending.current = value;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void write(), SAVE_DELAY_MS);
    },
    [write],
  );

  const flush = useCallback(() => void write(), [write]);

  useEffect(() => {
    // Quitting the app or reloading the window runs no React cleanup: send
    // what is waiting while the window still can.
    const onUnload = () => void write();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      // Leaving the file (prev/next, closing the detail) writes what is left.
      void write();
    };
  }, [write]);

  /**
   * Take a note changed elsewhere as the saved one, unless text typed here is
   * still waiting or being written. Returns whether it was taken.
   */
  const adopt = useCallback((incoming: string | null): boolean => {
    if (incoming === saved.current) return false;
    if (pending.current !== undefined || inFlight.current) return false;
    saved.current = incoming;
    return true;
  }, []);

  return { state, schedule, flush, adopt };
}
