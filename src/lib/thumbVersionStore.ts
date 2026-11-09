// How many times each file's thumbnail has been regenerated in this run, the
// cache buster a list thumbnail puts in its URL (the WebP is rewritten in
// place and served with a max-age, so only a new URL shows the new picture).
//
// Lives outside React and is read per file: Home used to keep it as state and
// hand the whole record down, so every `thumb:done` flush during a scan
// re-rendered Home, the list view under it and whatever detail or player was
// open, only for a handful of cards to pick up a new number. Now a flush
// notifies the thumbnails of the files it names and nothing else.
//
// Home is the one writer: it listens for thumb:done and flushes batches here.
// A MediaThumbnail given no `version` reads this store; views outside Home
// that track regenerations their own way (Discover, the detail view) pass
// their version explicitly.
import { useCallback, useSyncExternalStore } from "react";
import { mediaSortId } from "@/lib/mediaSortId";

const versions = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

function keyOf(workspaceId: string, fileId: number): string {
  return mediaSortId({ workspaceId, id: fileId });
}

/**
 * Add a batch of regenerations, keyed by mediaSortId ("<workspaceId>:<fileId>")
 * with how many times each happened, and notify the thumbnails showing those
 * files.
 */
export function bumpThumbVersions(batch: ReadonlyMap<string, number>): void {
  const touched: (() => void)[] = [];
  for (const [key, n] of batch) {
    versions.set(key, (versions.get(key) ?? 0) + n);
    const set = listeners.get(key);
    if (set) touched.push(...set);
  }
  for (const listener of touched) listener();
}

/** The file's version, read once outside React. */
export function getThumbVersion(workspaceId: string, fileId: number): number {
  return versions.get(keyOf(workspaceId, fileId)) ?? 0;
}

/** The file's version; re-renders only when that file's thumbnail is redone. */
export function useThumbVersionOf(workspaceId: string, fileId: number): number {
  const key = keyOf(workspaceId, fileId);
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set<() => void>();
      listeners.set(key, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      };
    },
    [key],
  );
  const get = () => versions.get(key) ?? 0;
  return useSyncExternalStore(subscribe, get, get);
}

/** Tests only: forget every version. */
export function resetThumbVersionsForTest(): void {
  versions.clear();
}
