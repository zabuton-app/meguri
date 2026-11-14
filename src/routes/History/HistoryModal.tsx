import { useEffect, useRef, type ReactNode } from "react";
import { useModalFocus } from "@/hooks/useModalFocus";
import type { ModalSize } from "@/routes/MediaDetail/MediaModal";

// Modal frame. Close on backdrop click / Esc. `size` toggles between a
// near-fullscreen layout ("large") and a centered compact panel ("small"),
// mirroring MediaModal's behavior.
export function HistoryModal({
  onClose,
  size = "small",
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
      // A nested layer (a Radix dialog, ConfirmDialog) calls preventDefault on
      // the Escape it consumed. Without this check, closing such a dialog would
      // also tear down the modal underneath it.
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const outerBase =
    "fixed inset-0 z-50 flex justify-center bg-black/70 backdrop-blur-sm";
  const outerClass =
    size === "small"
      ? `${outerBase} items-center p-4`
      : `${outerBase} p-2 sm:p-4 md:p-6`;
  const innerBase =
    "relative flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl";
  const innerClass =
    size === "small"
      ? `${innerBase} h-[85vh] max-h-[880px] max-w-3xl`
      : innerBase;

  return (
    <div
      className={outerClass}
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
