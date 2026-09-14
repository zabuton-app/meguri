// Whether the detail side peek is docked beside the list right now. While it
// is, the list is on screen and in use, so Home keeps its list-level keyboard
// shortcuts (search focus, page keys) alive even though the route is
// /file/:id — the test it otherwise uses for "the list is foreground". Lives
// outside React because Home and the detail route are siblings under the
// router, not parent and child (same reasoning as barVisibility.ts).
import { createHoldStore } from "@/hooks/createFlagStore";

const store = createHoldStore();

/** Mark the peek docked until the returned release function is called. */
export const holdPeekDocked: () => () => void = store.hold;

export const usePeekDocked: () => boolean = store.use;

/** Read once, from an event handler: the list's activation handlers run in
 *  every visible card, and subscribing there would re-render them all each
 *  time the peek opens or closes. */
export const isPeekDocked: () => boolean = store.get;
