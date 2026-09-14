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
import type { PlaybackQueue } from "@/lib/playbackQueue";

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
