// The thumbnail slot: where a video's poster frame, an image's preview and an
// audio track's embedded cover art all live. Every surface that shows one used
// to build the URL and the "is there a file behind it" test by hand, and the
// variants had drifted (some gated on status alone, some skipped the cache
// buster). One definition of each keeps them in step.

/** Whether a thumbnail file actually exists for the row.
 *
 *  `thumbStatus === "done"` alone is not enough: audio without embedded cover
 *  art is marked done (a normal outcome, not a failure) with no file written,
 *  and a URL built for it would 404. `hasThumb` is the on-disk truth. */
export function hasThumbFile(row: {
  thumbStatus: string;
  hasThumb: number;
}): boolean {
  return row.thumbStatus === "done" && row.hasThumb === 1;
}

/** URL of the file's thumbnail on the local media server, or null while the
 *  server origin (or the owning workspace) is not known yet.
 *
 *  `version` is the `thumb:done` cache buster: the main process rewrites the
 *  WebP in place when a thumbnail is regenerated, so the URL has to change for
 *  the browser to fetch it again. Omit it for surfaces that never live through
 *  a regeneration. */
export function thumbUrl(
  mediaBase: string,
  workspaceId: string,
  fileId: number,
  version?: number,
): string | null {
  if (!mediaBase || !workspaceId) return null;
  // Workspace ids are hex hashes today; encoded anyway so a future id shape
  // cannot break out of the path segment.
  const base = `${mediaBase}/ws/${encodeURIComponent(workspaceId)}/thumb/${fileId}`;
  return version == null ? base : `${base}?v=${version}`;
}
