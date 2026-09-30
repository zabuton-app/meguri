// The file under the list's keyboard focus, for the command menu.
//
// The focus ring is each view's own state (useGridKeyboardNav), while the
// menu that acts on it is mounted by Home beside the views. The view publishes
// the focused row here, and the menu reads it when it opens.
import { useEffect, useSyncExternalStore } from "react";
import type { FileRow } from "@/ipc/types";
import type { FolderViewEntry } from "@/hooks/useFolderEntries";

let value: FileRow | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getFocusedFile = (): FileRow | null => value;

/** Publish the focused file (null: none, or a folder card). */
export function setFocusedFile(next: FileRow | null): void {
  if (next === value) return;
  value = next;
  listeners.forEach((l) => l());
}

export function useFocusedFile(): FileRow | null {
  return useSyncExternalStore(subscribe, getFocusedFile);
}

/**
 * Publish a view's focused entry for as long as the view is mounted. A folder
 * card has no file actions, so it publishes nothing.
 */
export function usePublishFocusedFile(
  entries: FolderViewEntry[],
  focusedIndex: number,
): void {
  const entry = entries[focusedIndex];
  const file = entry?.kind === "file" ? entry.file : null;
  useEffect(() => {
    setFocusedFile(file);
  }, [file]);
  useEffect(() => () => setFocusedFile(null), []);
}
