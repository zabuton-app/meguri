// Whether the bottom player bar should stay out of the way. While the detail
// view is open the bar would sit on top of the modal — and for audio it would
// duplicate the transport shown under the cover art — so it hides. Lives outside
// React because the bar is mounted in App, outside the router, where the detail
// route cannot reach it with props. Playback itself is untouched: hiding the bar
// never pauses anything.
import { useSyncExternalStore } from "react";

let suppressed = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setBarSuppressed(value: boolean): void {
  if (suppressed === value) return;
  suppressed = value;
  listeners.forEach((l) => l());
}

export function useBarSuppressed(): boolean {
  return useSyncExternalStore(subscribe, () => suppressed);
}
