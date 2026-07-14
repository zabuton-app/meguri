// Builds the detail-route URL for a file. Centralizes the query-string layout
// so callers don't need to know whether `?` or `&` is the right separator and
// so flags (autoplay opt-out, initial seek, modal origin) compose safely.
export interface FileHrefOpts {
  /** Set to false to open the detail view paused (`?autoplay=0`). */
  autoplay?: boolean;
  /** Initial seek position in seconds (e.g. Discovery scene click). */
  t?: number;
  /** Origin marker for the modal-close fallback (e.g. "discover"). */
  from?: string;
}

export function fileHref(
  fileId: number,
  workspaceId: string,
  opts: FileHrefOpts = {},
): string {
  const params = new URLSearchParams();
  params.set("ws", workspaceId);
  if (opts.autoplay === false) params.set("autoplay", "0");
  if (opts.t) params.set("t", String(opts.t));
  if (opts.from) params.set("from", opts.from);
  return `/file/${fileId}?${params.toString()}`;
}
