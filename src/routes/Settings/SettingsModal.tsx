import { useEffect, useRef, type ReactNode } from "react";
import { useModalFocus } from "@/hooks/useModalFocus";

// Near-fullscreen modal frame. Close on backdrop click / Esc (same approach as
// MediaModal); focus stays inside while open (see useModalFocus).

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
  useModalFocus(panelRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A layer on top (Radix Select content, a nested dialog) that already
      // handled the key marks it so; closing over it would break its own
      // keyboard handling.
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        data-slot="modal-panel"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={SETTINGS_MODAL_TITLE_ID}
        className="relative flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
