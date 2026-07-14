import { useEffect, type ReactNode, type Ref } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TFunc } from "@/i18n/I18nProvider";

export type ModalSize = "large" | "small";

// Modal frame. Close on backdrop click / Esc. `size` toggles between a
// near-fullscreen layout ("large") and a centered compact panel ("small").
// `containerRef` exposes the inner panel so the player can request fullscreen
// on the whole modal (YouTube-style); `fullscreen` drops the frame decorations
// while that element is the fullscreen element.
export function MediaModal({
  onClose,
  size = "large",
  fullscreen = false,
  containerRef,
  children,
}: {
  onClose: () => void;
  size?: ModalSize;
  fullscreen?: boolean;
  containerRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // While in fullscreen, Esc exits fullscreen (browser default) — keep the modal open.
        if (document.fullscreenElement) return;
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const outerBase = "fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm";
  const outerClass =
    size === "small"
      ? `${outerBase} justify-center p-4 sm:p-6 md:p-10`
      : `${outerBase} p-2 sm:p-4 md:p-6`;
  const innerBase = "relative flex min-h-0 w-full flex-col overflow-hidden";
  const innerClass = fullscreen
    ? `${innerBase} bg-bg`
    : `${innerBase} rounded-xl border border-border bg-bg shadow-2xl${
        size === "small" ? " max-w-4xl" : ""
      }`;

  return (
    <div
      className={outerClass}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={containerRef}
        className={innerClass}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function TopBar({
  onClose,
  title,
  onPrev,
  onNext,
  canPrev,
  canNext,
  prevHint,
  nextHint,
  size,
  onToggleSize,
  t,
}: {
  onClose: () => void;
  title?: string;
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  prevHint?: string;
  nextHint?: string;
  size?: ModalSize;
  onToggleSize?: () => void;
  t: TFunc;
}) {
  const isSmall = size === "small";
  const toggleLabel = isSmall
    ? t("media.modalMaximize")
    : t("media.modalMinimize");
  return (
    <header className="flex items-center gap-2 border-b border-border bg-bg px-3 py-2.5">
      {(onPrev || onNext) && (
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onPrev}
            disabled={!canPrev}
            aria-label={t("media.prev")}
            title={
              prevHint ? `${t("media.prev")} (${prevHint})` : t("media.prev")
            }
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onNext}
            disabled={!canNext}
            aria-label={t("media.next")}
            title={
              nextHint ? `${t("media.next")} (${nextHint})` : t("media.next")
            }
          >
            <ChevronRight />
          </Button>
        </div>
      )}
      {title && (
        <span className="truncate text-sm font-medium text-fg" title={title}>
          {title}
        </span>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        {onToggleSize && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onToggleSize}
            aria-label={toggleLabel}
            aria-pressed={isSmall}
            title={toggleLabel}
          >
            {isSmall ? <Maximize2 /> : <Minimize2 />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={onClose}
          title={`${t("common.close")} (Esc)`}
        >
          <X />
        </Button>
      </div>
    </header>
  );
}
