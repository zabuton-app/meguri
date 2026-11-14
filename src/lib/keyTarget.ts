// Who a key press on the window is for. The views listen on the window, so a
// key reaches every one of them; these say when a view should leave it alone.

/** What counts as a layer laid over a view: a dialog or a menu. */
export const LAYER_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"]';

/** A field that takes keyboard input has focus: the key is meant for it. */
export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

/**
 * A dialog or menu is open over the view that `inView` (any element inside the
 * view) belongs to: the key is that layer's, not the view's. A view that is
 * a dialog itself does not count as over itself, nor does a layer it sits in.
 * Null (a view not rendered yet) has every open layer over it.
 */
export function isLayerOnTop(inView: Element | null): boolean {
  const mine = inView?.closest(LAYER_SELECTOR) ?? null;
  for (const layer of document.querySelectorAll(LAYER_SELECTOR)) {
    if (layer === mine || (mine && layer.contains(mine))) continue;
    // A Radix popup playing its exit animation is already gone for the user.
    if (layer.getAttribute("data-state") === "closed") continue;
    return true;
  }
  return false;
}
