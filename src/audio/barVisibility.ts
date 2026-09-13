// Whether the bottom player bar should stay out of the way. While the detail
// view is open the bar would sit on top of the modal — and for audio it would
// duplicate the transport shown under the cover art — so it hides. Lives outside
// React because the bar is mounted in App, outside the router, where the detail
// route cannot reach it with props. Playback itself is untouched: hiding the bar
// never pauses anything.
//
// Counted rather than a plain boolean: each view that needs the bar gone takes a
// hold and releases it on the way out, so two holders (StrictMode's double
// mount, a view replaced by another in the same frame) cannot release each
// other's hold, and a release that runs twice is harmless.
import { createFlagStore } from "@/hooks/createFlagStore";

const store = createFlagStore();
let holds = 0;

/** Hide the bar until the returned release function is called. */
export function holdBarSuppressed(): () => void {
  holds++;
  store.set(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    if (holds === 0) store.set(false);
  };
}

export const useBarSuppressed: () => boolean = store.use;
