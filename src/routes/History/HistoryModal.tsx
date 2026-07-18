import { useEffect, type ReactNode } from "react";
import type { ModalSize } from "@/routes/MediaDetail/MediaModal";

// Modal frame. Close on backdrop click / Esc. `size` toggles between a
// near-fullscreen layout ("large") and a centered compact panel ("small"),
// mirroring MediaModal's behavior.
export function HistoryModal({
  onClose,
  size = "small",
  children,
}: {
  onClose: () => void;
  size?: ModalSize;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
    >
      <div className={innerClass} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
