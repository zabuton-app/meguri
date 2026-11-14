import { useEffect, useRef, type ReactNode } from "react";
import { useModalFocus } from "@/hooks/useModalFocus";
import type { ModalSize } from "@/routes/MediaDetail/MediaModal";

// Near-fullscreen modal frame. Close on backdrop click / Esc. `size` toggles
// between the full-bleed immersive layout ("large") and a centered compact
// panel ("small"), mirroring MediaDetail's MediaModal.
export function DiscoverModal({
  onClose,
  size = "large",
  titleId,
  children,
}: {
  onClose: () => void;
  size?: ModalSize;
  /** The id of the title element the caller renders, for aria-labelledby. */
  titleId: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A layer on top (the command menu, a Radix popup, ConfirmDialog) calls
      // preventDefault on the Escape it consumed; closing Discover too would
      // take the view out from under it.
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const innerClass =
    size === "small"
      ? "relative h-[85vh] max-h-[880px] w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-bg shadow-2xl"
      : "relative h-full w-full overflow-hidden rounded-xl border border-border bg-bg shadow-2xl";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        data-slot="modal-panel"
        className={`${innerClass} outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
