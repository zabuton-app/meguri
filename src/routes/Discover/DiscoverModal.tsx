import { useEffect, type ReactNode } from "react";
import type { ModalSize } from "@/routes/MediaDetail/MediaModal";

// Near-fullscreen modal frame. Close on backdrop click / Esc. `size` toggles
// between the full-bleed immersive layout ("large") and a centered compact
// panel ("small"), mirroring MediaDetail's MediaModal.
export function DiscoverModal({
  onClose,
  size = "large",
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
    >
      <div className={innerClass} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
