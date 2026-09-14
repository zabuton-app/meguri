// Builds the playlist-route URL. The player is reached from two directions
// that both name a file — the detail view handing back a parked pass
// (`resume`) or starting a fresh one on the file it shows (`start`) — and
// this keeps the parameter names in one place for the player to read back
// (see Player's arrival handling) rather than spelled out at each call.
import { queueKey } from "@/lib/playbackQueue";

export const PLAY_PARAMS = {
  /** The file a parked pass was left on: `<workspaceId>:<fileId>`. */
  resume: "resume",
  /** The file to open a fresh pass on: `<workspaceId>:<fileId>`. */
  start: "start",
  /** Where that file's playback got to, in whole seconds. */
  t: "t",
} as const;

export interface PlayHrefOpts {
  resume?: { workspaceId: string; fileId: number };
  start?: { workspaceId: string; fileId: number };
  t?: number;
}

export function playHref(opts: PlayHrefOpts = {}): string {
  const params = new URLSearchParams();
  if (opts.resume) params.set(PLAY_PARAMS.resume, queueKey(opts.resume));
  if (opts.start) params.set(PLAY_PARAMS.start, queueKey(opts.start));
  if (opts.t) params.set(PLAY_PARAMS.t, String(opts.t));
  const query = params.toString();
  return query ? `/play?${query}` : "/play";
}
