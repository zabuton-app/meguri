// Whether the bottom player bar should stay out of the way. While the detail
// view is open the bar would sit on top of the modal — and for audio it would
// duplicate the transport shown under the cover art — so it hides. Lives outside
// React because the bar is mounted in App, outside the router, where the detail
// route cannot reach it with props. Playback itself is untouched: hiding the bar
// never pauses anything.
import { createHoldStore } from "@/hooks/createFlagStore";

const store = createHoldStore();

/** Hide the bar until the returned release function is called. */
export const holdBarSuppressed: () => () => void = store.hold;

export const useBarSuppressed: () => boolean = store.use;
