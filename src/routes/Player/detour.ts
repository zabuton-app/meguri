// The pass the playlist leaves behind when it steps out to the detail view.
//
// A module-level slot rather than component state because that trip unmounts
// the player (the detail route is a sibling, not a layer on top) — the same
// reason Discover keeps its carousel position this way.
//
// Claimed once on the player's mount and dropped immediately, and only
// honoured when the detail view names the very file the pass was parked on
// (`/play?resume=<ws>:<id>`): a leftover pass must never resurface under a
// later, unrelated playback of some other list.
import { PLAY_PARAMS } from "@/lib/playHref";
import {
  parseQueueKey,
  queueKey,
  type PlaybackQueue,
} from "@/lib/playbackQueue";

export interface DetourPass {
  queue: PlaybackQueue;
  /** Queue key of the item the pass was parked on. */
  key: string;
  /** Seconds into that item when the player stepped out. */
  sec: number;
}

let parked: DetourPass | null = null;

/** Leave a pass behind before stepping out to the detail view. */
export function parkPass(pass: DetourPass): void {
  parked = pass;
}

/** The parked pass, if it was parked on the item `token` names; else null. */
export function claimPass(token: string | null): DetourPass | null {
  return token && parked?.key === token ? parked : null;
}

/** Forget the parked pass (called once the player has mounted). */
export function dropPass(): void {
  parked = null;
}

/**
 * The file the URL named on arrival, and what to make of it: a pass to pick
 * back up (`?resume=`, with the queue it left behind) or a file to start a new
 * pass on (`?start=<ws>:<id>`, the detail view handing the file it shows over
 * to the playlist). Either way, the item's own media is already under way
 * elsewhere — a video handed across (see videoHandOff.ts), a track in the
 * bar — and must be carried on, not restarted.
 */
export interface Arrival {
  key: string;
  /** The second to fall back to when nothing better is handed over. */
  sec: number;
  /** A resumed pass: the queue it left behind. */
  queue?: PlaybackQueue;
  /** A fresh pass: the file to seed the list's queue on. */
  startAt?: { workspaceId: string; fileId: number };
}

/** The URL parameters an arrival is read from; spent once read. */
export const ARRIVAL_PARAMS = [
  PLAY_PARAMS.resume,
  PLAY_PARAMS.start,
  PLAY_PARAMS.t,
] as const;

/**
 * Read the arrival off the URL. A `start` needs no slot: the list itself is
 * the queue, opened on that file — which is also where a `resume` whose pass
 * is gone (the history walked back to it, the URL reopened) falls back to,
 * when both are named. The second handed over (`t`) is folded in too: the
 * detail view hands over where *it* got to — ahead of the detour whenever the
 * user kept watching there, or wherever it was when the playlist was asked
 * for from it; the parked second is the fallback for an item with no player
 * of its own (a picture).
 */
export function readArrival(searchParams: URLSearchParams): Arrival | null {
  const handedOver = searchParams.get(PLAY_PARAMS.t);
  const sec =
    handedOver != null && Number.isFinite(Number(handedOver))
      ? Math.max(0, Math.floor(Number(handedOver)))
      : null;
  const pass = claimPass(searchParams.get(PLAY_PARAMS.resume));
  if (pass) return { ...pass, sec: sec ?? pass.sec };
  const startAt = parseQueueKey(searchParams.get(PLAY_PARAMS.start));
  return startAt ? { key: queueKey(startAt), sec: sec ?? 0, startAt } : null;
}
