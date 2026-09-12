import { useEffect, useRef, type ReactNode } from "react";

// Near-fullscreen modal frame. Close on backdrop click / Esc (same approach as MediaModal).
//
// The frame also owns the focus contract that aria-modal promises: focus moves
// into the panel on open, Tab cycles inside it, and focus returns to the opener
// on close. Without the trap, Tab walks the app behind the backdrop — reachable
// by keyboard yet hidden from assistive tech.
const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls], iframe, details > summary, [tabindex]:not([tabindex="-1"])';

// Referenced by the panel's aria-labelledby; the caller puts this id on the title.
export const SETTINGS_MODAL_TITLE_ID = "settings-modal-title";

export function SettingsModal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Keep the latest onClose in a ref so the trap effect can run once per mount.
  // Re-running it on every render would steal focus back to the first item and
  // briefly return it to the opener behind the backdrop.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        // visibilityProperty defaults to false, which would let visibility:hidden
        // elements through as phantom tab stops. Unavailable in jsdom; assume
        // visible there.
        (el) =>
          el.checkVisibility?.({
            visibilityProperty: true,
            contentVisibilityAuto: true,
          }) ?? true,
      );
    // Focus the panel itself, not the first item: the first tabbable is the
    // close button, and focusing it would make Enter right after open dismiss
    // the modal (same default as Radix Dialog).
    panel.focus();

    const onKey = (e: KeyboardEvent) => {
      // A Radix layer (Select content, nested dialog) that already handled the
      // key renders into a portal outside the panel; yanking focus back or
      // closing over it would break its own keyboard handling.
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Known limit: "inside" is panel-scoped, not layer-scoped. Focus in a
      // nested portal layer that does NOT claim Tab itself (unlike Radix
      // Select, which always preventDefaults it) gets pulled back here.
      const inside = active instanceof Node && panel.contains(active);
      if (e.shiftKey) {
        // Treat the panel itself (focused via container click) as the edge,
        // or Shift+Tab would walk out to the app behind the backdrop.
        if (!inside || active === first || active === panel) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // A detached opener would make focus() a silent no-op and drop focus on
      // <body>; skip it so the failure mode is at least explicit.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={SETTINGS_MODAL_TITLE_ID}
        className="relative flex h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
