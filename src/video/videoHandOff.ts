// Handing a playing <video> element from one route to the next.
//
// The playlist player and the detail view are sibling routes: opening one
// unmounts the other, and a <video> that leaves the document pauses. Both used
// to build a fresh element and seek it to the second the other had reached,
// which is a visible and audible cut. Instead, a host that knows the next
// route will show the very same file announces a hand-off for that file's
// source before navigating; the element playing that source is then parked
// in the document (hidden, still playing) instead of being torn down when its
// host unmounts, and the next host to mount with that source adopts it.
//
// Why not one element outside the router, the way audio is done? Audio is one
// track at a time by definition, so a single element in a provider *is* the
// model. Video is a per-surface thing — several players can exist and each
// owns its element — and only these two routes ever show the same file back
// to back; a hand-off covers that without changing how every other video
// surface works. Outside a hand-off nothing changes: every host gets its own
// element and tears it down on unmount.
//
// Public surface: announceVideoHandOff (the two routes) and the constants.
// park / take / destroy are VideoElement's; resetVideoHandOff is for tests.
import { isSameMediaSource } from "@/lib/mediaSrc";

/** How long an announcement stays valid: the navigation it precedes unmounts
 *  the host within the same tick, so this only has to cover a slow commit. */
export const HAND_OFF_ANNOUNCE_MS = 2000;
/** How long a parked element waits for its next host. Normally the arriving
 *  route mounts in the very commit the leaving one unmounts in; this is the
 *  cap on how long a hidden element may keep playing if it never comes. */
export const HAND_OFF_PARK_MS = 500;

let announced: { src: string; until: number } | null = null;
let parked: {
  el: HTMLVideoElement;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
let holder: HTMLDivElement | null = null;

/** Whether the element is loaded from `src`, possibly re-served from a `?t=`. */
export function isSameSource(el: HTMLVideoElement, src: string): boolean {
  return isSameMediaSource(el.getAttribute("src"), src);
}

/** Announce that the route about to be shown plays `src`: the host playing it
 *  may park its element when it unmounts rather than tear it down. */
export function announceVideoHandOff(src: string): void {
  announced = { src, until: Date.now() + HAND_OFF_ANNOUNCE_MS };
}

/** Stop and release an element for good. */
export function destroyVideo(el: HTMLVideoElement): void {
  el.pause();
  // Dropping src alone leaves the buffered data attached; load() releases it.
  el.removeAttribute("src");
  el.load();
  el.remove();
}

function dropParked(): void {
  if (!parked) return;
  clearTimeout(parked.timer);
  const { el } = parked;
  parked = null;
  destroyVideo(el);
}

/** A host is letting go of its element. Returns true when the element was
 *  parked for a hand-off (and so must not be torn down by the caller): only
 *  the element playing the announced source, and only a healthy one — an
 *  element that has failed would be adopted with no load left to wait for. */
export function parkVideoForHandOff(el: HTMLVideoElement): boolean {
  if (!announced) return false;
  const { src, until } = announced;
  if (Date.now() > until || !isSameSource(el, src) || el.error) return false;
  announced = null;
  dropParked();
  if (!holder || !holder.isConnected) {
    holder = document.createElement("div");
    holder.setAttribute("data-slot", "video-hand-off");
    // In the document (leaving it would pause the element) but out of sight
    // and out of the layout.
    holder.style.cssText =
      "position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;visibility:hidden";
    document.body.appendChild(holder);
  }
  holder.appendChild(el);
  parked = {
    el,
    timer: setTimeout(() => {
      // Nobody came for it: the route that was announced did not show this
      // file after all (or took too long), so stop it like any other unmount.
      if (parked?.el === el) dropParked();
    }, HAND_OFF_PARK_MS),
  };
  return true;
}

/** The element parked for `src`, if a hand-off left one; the caller becomes
 *  its host. A host for some *other* file means the announced one is not
 *  coming, so the parked element is torn down rather than left playing out
 *  its grace period; a host with no source yet decides nothing. */
export function takeHandedOffVideo(src: string): HTMLVideoElement | null {
  if (!parked) return null;
  if (!isSameSource(parked.el, src) || parked.el.error) {
    if (src) dropParked();
    return null;
  }
  clearTimeout(parked.timer);
  const { el } = parked;
  parked = null;
  return el;
}

/** Test hook: forget any pending hand-off and tear down a parked element. */
export function resetVideoHandOff(): void {
  announced = null;
  dropParked();
}
