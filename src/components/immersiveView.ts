// Immersive views (Discover, the playlist player, the file details' modal,
// the image comparison) cover the whole window, the title bar's band
// included, and the bar's window buttons step aside while one is open: the
// app's own would sit on top of the view's controls, and macOS draws its
// traffic lights over whatever is there. Whether one is open lives outside
// React because the bar is mounted in App, beside the router the views live
// in. Home reads it too: the comparison is not a route, so the path alone
// does not tell Home its list is covered.
import { useLayoutEffect } from "react";
import { createHoldStore } from "@/hooks/createFlagStore";

const store = createHoldStore();

/** Mark an immersive view open until the returned release function is called. */
export const holdImmersiveView: () => () => void = store.hold;

export const useImmersiveViewOpen: () => boolean = store.use;

/** For tests: whether one is open, read once. */
export const isImmersiveViewOpen: () => boolean = store.get;

/**
 * The backdrop class of an immersive view (modal-backdrop-full in
 * styles.css), with the hold that moves the bar's buttons aside: the two go
 * together, so a view takes both here. A layout effect, so the buttons go in
 * the frame the view first paints, and a view replacing another in the same
 * commit hands the hold over without the buttons showing in between.
 */
export function useImmersiveBackdrop(active = true): string {
  useLayoutEffect(() => (active ? holdImmersiveView() : undefined), [active]);
  return "modal-backdrop-full";
}
