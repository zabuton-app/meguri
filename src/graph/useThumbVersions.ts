// Where a file node's thumbnail is, for the hover card (GraphHoverThumbnail)
// and the flat canvas, which draws file nodes as their thumbnails when few
// are shown: whether there is one, and its URL under the current cache
// buster. One definition, so the two never disagree on either.
//
// Not the detail view's useThumbVersion, which follows a single file.
import { useEffect, useMemo, useState } from "react";
import { useAppStatus } from "@/hooks/useAppStatus";
import { events } from "@/ipc/client";
import { thumbUrl } from "@/lib/thumbUrl";
import type { FileNodeAttrs } from "./model/types";

/** `thumb:done` events are gathered this long before they re-render the
 *  hook's users. */
const VERSION_FLUSH_MS = 100;

// The last cache buster handed out. Each is larger than any before it, in
// this run of the app or an earlier one (the HTTP cache outlives both a
// remount of the view and a restart).
let lastVersion = 0;
function nextVersion(): number {
  lastVersion = Math.max(lastVersion + 1, Date.now());
  return lastVersion;
}

export interface ThumbVersions {
  /** The file's thumbnail URL and the cache buster in it, or null while it
   *  has none (or the media server is not known yet). */
  thumbOf: (
    node: Pick<FileNodeAttrs, "workspaceId" | "fileId" | "hasThumb">,
  ) => { url: string; version: number } | null;
}

/**
 * The WebP is rewritten in place when a thumbnail is regenerated, and served
 * with a max-age, so the URL has to change for the new picture to show.
 * Every mount starts from a version of its own: the view cannot know what
 * was regenerated while it was away (a 2D / 3D switch remounts it, and so
 * does a visit to the list). A file regenerated since then, by `thumb:done`,
 * gets a newer one, keyed "<workspaceId>:<fileId>" (or the id alone when the
 * event names no workspace). The event also means a file now exists behind
 * the slot: the graph's payload is not read again as a scan fills
 * thumbnails in, so a file drawn before its thumbnail was made would
 * otherwise never show one.
 * Kept here rather than taken from Home's counter: only the card and the
 * flat canvas re-render, not the whole graph view, on every thumbnail a scan
 * finishes.
 */
export function useThumbVersions(): ThumbVersions {
  const mediaBase = useAppStatus().data?.mediaBase ?? "";
  const [mounted] = useState(nextVersion);
  const [regenerated, setRegenerated] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  useEffect(() => {
    let pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // The unlisten arrives a microtask after the subscription is live; a
    // cleanup that runs first must still take the subscription down.
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void events
      .onThumbDone((event) => {
        pending.add(
          event.workspaceId
            ? `${event.workspaceId}:${event.id}`
            : String(event.id),
        );
        // Dozens arrive per second during a scan: one update per window.
        timer ??= setTimeout(() => {
          timer = null;
          const batch = pending;
          pending = new Set();
          const version = nextVersion();
          setRegenerated((prev) => {
            const next = new Map(prev);
            for (const key of batch) next.set(key, version);
            return next;
          });
        }, VERSION_FLUSH_MS);
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });
    return () => {
      cancelled = true;
      unlisten?.();
      if (timer) clearTimeout(timer);
    };
  }, []);
  // The same function until a thumbnail is regenerated: the canvas asks
  // for pictures again whenever it changes.
  return useMemo(() => {
    // The newer of the two: an event may name the workspace or not.
    const since = (workspaceId: string, fileId: number) =>
      Math.max(
        regenerated.get(`${workspaceId}:${fileId}`) ?? 0,
        regenerated.get(String(fileId)) ?? 0,
      );
    return {
      thumbOf: ({ workspaceId, fileId, hasThumb }) => {
        const regen = since(workspaceId, fileId);
        // `thumb:done` is only sent once a thumbnail file was written.
        if (!hasThumb && regen === 0) return null;
        const version = Math.max(mounted, regen);
        const url = thumbUrl(mediaBase, workspaceId, fileId, version);
        return url ? { url, version } : null;
      },
    };
  }, [mounted, regenerated, mediaBase]);
}
