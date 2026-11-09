// Which tours this user has been through, kept in localStorage like the other
// renderer preferences. Finishing and skipping both count as seen.
import { FIRST_LAUNCH_TOUR_ID, type Tour } from "./tours";

const LS_KEY = "meguri.tours";
/** Every key the renderer stores starts with this. */
const APP_KEY_PREFIX = "meguri.";

function hasOtherAppKeys(): boolean {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key !== LS_KEY && key.startsWith(APP_KEY_PREFIX)) return true;
  }
  return false;
}

/**
 * Load the seen list. The first time it is missing, the user is either new or
 * upgrading from a version without tours: anything else the app has stored
 * gives the upgrade away, and an existing user is counted as having seen the
 * first-launch tour. The answer is written straight back, so a new user who
 * quits halfway through still gets the tour next time — and is not mistaken
 * for an existing user by the keys this launch leaves behind.
 *
 * Call it before the providers write their own keys (during the first render).
 */
export function loadSeenTours(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw != null) {
      const parsed: unknown = JSON.parse(raw);
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((id): id is string => typeof id === "string")
          : [],
      );
    }
    const seen = new Set<string>(
      hasOtherAppKeys() ? [FIRST_LAUNCH_TOUR_ID] : [],
    );
    saveSeenTours(seen);
    return seen;
  } catch {
    // Storage unavailable or corrupt: do not pester the user every launch.
    return new Set([FIRST_LAUNCH_TOUR_ID]);
  }
}

export function saveSeenTours(seen: ReadonlySet<string>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...seen]));
  } catch {
    /* storage may be full or disabled; tolerate silently */
  }
}

/**
 * The tour to show on its own, if any: the first-launch tour until it has been
 * seen, then each feature tour not seen yet, oldest first.
 */
export function nextPendingTour(
  seen: ReadonlySet<string>,
  featureTours: readonly Tour[],
): string | null {
  if (!seen.has(FIRST_LAUNCH_TOUR_ID)) return FIRST_LAUNCH_TOUR_ID;
  return featureTours.find((tour) => !seen.has(tour.id))?.id ?? null;
}

/**
 * The seen list once `tourId` has ended. Ending the first-launch tour also
 * covers every feature tour, so a new user does not get a stack of them
 * straight after the full tour.
 */
export function markTourSeen(
  seen: ReadonlySet<string>,
  tourId: string,
  featureTours: readonly Tour[],
): Set<string> {
  const next = new Set(seen);
  next.add(tourId);
  if (tourId === FIRST_LAUNCH_TOUR_ID) {
    for (const tour of featureTours) next.add(tour.id);
  }
  return next;
}
