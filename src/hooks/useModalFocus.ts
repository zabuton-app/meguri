import { useEffect, useRef, type RefObject } from "react";

// The focus contract that aria-modal promises: focus moves into the panel on
// open, Tab cycles inside it, and focus returns to the opener on close.
// Without the trap, Tab walks the app behind the backdrop — reachable by
// keyboard yet hidden from assistive tech. Esc stays with each modal.
const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls], iframe, details > summary, [tabindex]:not([tabindex="-1"])';

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // visibilityProperty defaults to false, which would let visibility:hidden
    // elements through as phantom tab stops. Unavailable in jsdom; assume
    // visible there.
    (el) =>
      el.checkVisibility?.({
        visibilityProperty: true,
        contentVisibilityAuto: true,
      }) ?? true,
  );
}

/**
 * Where focus goes back to. An item of a menu (a menu item that asked for
 * confirmation) goes away with the menu, so the menu's trigger stands in.
 */
function returnTarget(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  const menu = el.closest('[role="menu"]');
  if (!menu?.id) return el;
  return (
    document.querySelector<HTMLElement>(
      `[aria-controls="${CSS.escape(menu.id)}"]`,
    ) ?? el
  );
}

/**
 * Keep keyboard focus in `panelRef` while `active` (a modal that is not shown
 * as a modal, such as the detail view's side peek, passes false). The panel
 * is the element focus stays in (it may sit inside the dialog element, below
 * its backdrop) and needs tabIndex={-1}. Focus starts on `initialFocus` if
 * given, else on the panel itself: the first tabbable is often the close
 * button, and focusing it would make Enter right after open dismiss the modal
 * (same default as Radix Dialog).
 */
export function useModalFocus(
  panelRef: RefObject<HTMLElement | null>,
  {
    active = true,
    initialFocus,
  }: {
    active?: boolean;
    initialFocus?: RefObject<HTMLElement | null>;
  } = {},
): void {
  // Kept across re-runs of the effect: one that starts with focus already
  // inside the panel (StrictMode's second run, the peek turning into the
  // modal) would otherwise take the panel itself for the opener. Recorded while
  // inactive too, so the peek's opener is the one the modal returns to.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focused = document.activeElement;
    if (!(focused instanceof Node && panel.contains(focused))) {
      openerRef.current = returnTarget(focused);
    }
    if (!active) return;
    (initialFocus?.current ?? panel).focus();

    const onKey = (e: KeyboardEvent) => {
      // A layer that already handled the key (Radix Select content) renders
      // into a portal outside the panel; yanking focus back would break its
      // own keyboard handling.
      if (e.key !== "Tab" || e.defaultPrevented) return;
      const focused = document.activeElement;
      const inside = focused instanceof Node && panel.contains(focused);
      // Focus outside the panel, and not dropped on <body>, sits in a layer
      // laid over this one (a nested dialog, ConfirmDialog): its Tab is that
      // layer's to handle.
      if (!inside && focused && focused !== document.body) return;
      const items = focusables(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey) {
        // Treat the panel itself (focused on open or via container click) as
        // the edge, or Shift+Tab would walk out to the app behind the backdrop.
        if (!inside || focused === first || focused === panel) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || focused === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Still on screen with focus inside it: the panel stopped being a modal
      // (the detail view switched to the peek) rather than closing, so focus
      // stays where the user put it.
      if (panel.isConnected && panel.contains(document.activeElement)) return;
      // A detached opener would make focus() a silent no-op and drop focus on
      // <body>; skip it so the failure mode is at least explicit.
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
    };
    // initialFocus is read once on open, like the opener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, panelRef]);
}
