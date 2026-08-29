// Playback volume, shared by every media surface in the renderer (the detail
// view's player and the playlist player's control bar). It lives outside React
// on purpose: the playlist chrome has to show and change the volume while no
// media element is mounted at all (an image is on screen), and two players open
// at once must never drift apart. `useLocalStorage` gives each caller its own
// copy, which is exactly what must not happen here.
//
// The store is the single source of truth; a media element is a follower that
// gets the value applied to it and reports back through `syncFromElement`.
import { useSyncExternalStore } from "react";

// Persist across sessions. These are the keys the detail player has always
// written, so volumes saved by earlier versions carry over untouched.
const VOLUME_KEY = "meguri.player.volume";
const MUTED_KEY = "meguri.player.muted";

/**
 * Volume is a float; anything under this counts as "the same value". Exported
 * so the media element's own comparison uses the very same threshold — two
 * thresholds that drift apart would leave the element and the store disagreeing
 * with no way back.
 */
export const VOLUME_EPSILON = 0.001;

export interface VolumeState {
  /** 0..1. Kept as-is while muted, so unmuting restores the same loudness. */
  volume: number;
  muted: boolean;
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function readVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? clamp(n) : 1;
  } catch {
    return 1;
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

let state: VolumeState = { volume: readVolume(), muted: readMuted() };
const listeners = new Set<() => void>();

function persist(s: VolumeState) {
  try {
    localStorage.setItem(VOLUME_KEY, String(s.volume));
    localStorage.setItem(MUTED_KEY, s.muted ? "1" : "0");
  } catch {
    /* storage may be full or disabled; the in-memory value still stands */
  }
}

/**
 * Replace the state and notify, unless nothing actually changed. The early
 * return is what keeps element -> store -> element from looping: an element
 * echoing back the value it was just given stops here.
 */
function commit(next: VolumeState) {
  if (
    Math.abs(next.volume - state.volume) <= VOLUME_EPSILON &&
    next.muted === state.muted
  ) {
    return;
  }
  state = next;
  persist(state);
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

// Returns the same reference until something changes, which is what
// useSyncExternalStore needs to avoid re-rendering forever.
function getSnapshot(): VolumeState {
  return state;
}

/** Current volume/mute. Re-renders the caller only when the value changes. */
export function useVolume(): VolumeState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Set the absolute volume. Asking for sound implies leaving mute behind. */
export function setVolume(v: number): void {
  commit({ volume: clamp(v), muted: false });
}

/** Toggle mute without touching the volume, so unmuting restores it exactly. */
export function toggleMuted(): void {
  commit({ volume: state.volume, muted: !state.muted });
}

/**
 * Relative change (e.g. the keyboard's ±0.05 steps). Unlike {@link setVolume}
 * this leaves mute alone: nudging the level down while muted means "set it
 * lower for when the sound comes back", not "start playing it out loud now".
 */
export function bumpVolume(delta: number): void {
  commit({ volume: clamp(state.volume + delta), muted: state.muted });
}

/**
 * Take the value a media element reports (its `volumechange` event), which also
 * covers changes this store did not make. Muting through the element is a real
 * mute, so unlike {@link setVolume} this keeps whatever `muted` it was given.
 */
export function syncFromElement(volume: number, muted: boolean): void {
  commit({ volume: clamp(volume), muted });
}
