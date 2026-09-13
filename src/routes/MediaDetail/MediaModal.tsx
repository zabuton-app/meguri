import { useEffect, type ReactNode, type Ref } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  PanelRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TFunc } from "@/i18n/I18nProvider";

export type ModalSize = "large" | "small";

// How the detail view is presented: a modal over the whole window, or a side
// peek — a sheet docked to the right edge of the list area that leaves the
// list, the toolbar and the bottom player bar visible and usable.
export type Presentation = "modal" | "peek";

// Shared localStorage key: MediaDetail and Discover persist one common size.
export const MODAL_SIZE_KEY = "meguri.media.modalSize";
// Remembered separately from the size, so switching to the peek and back lands
// on the modal size that was last chosen.
export const PRESENTATION_KEY = "meguri.media.presentation";

// Frame around the detail view. Close on Esc, and on backdrop click when there
// is a backdrop (the modal). `size` toggles the modal between a
// near-fullscreen layout ("large") and a centered compact panel ("small");
// `presentation: "peek"` renders the side sheet instead, positioned against the
// nearest positioned ancestor (Home's list area). `containerRef` exposes the
// inner panel so the player can request fullscreen on the whole frame
// (YouTube-style); `fullscreen` drops the frame decorations while that element
// is the fullscreen element.
export function MediaModal({
  onClose,
  size = "large",
  presentation = "modal",
  fullscreen = false,
  containerRef,
  children,
}: {
  onClose: () => void;
  size?: ModalSize;
  presentation?: Presentation;
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

  // One tree shape for both presentations: only classes and ARIA change, so
  // switching modal ↔ peek re-styles the frame without remounting what is
  // inside it (a playing <video> keeps its position; a half-typed tag stays).
  // In the peek the outer div is `display: contents`, so the sheet's
  // `absolute` resolves against Home's list area, not against the frame.
  // Position and width are set per variant rather than in a shared base, so
  // no utility of the base can outrank a variant's (Tailwind orders the
  // generated rules, not the class string).
  const isPeek = presentation === "peek";
  const innerBase = "flex min-h-0 flex-col overflow-hidden bg-bg";
  let outerClass: string;
  let innerClass: string;
  if (isPeek) {
    outerClass = "contents";
    // No backdrop: the list stays interactive beside the sheet. The sheet
    // overlays the list's right edge rather than pushing it, so opening and
    // closing never reflows the grid. z-40 keeps it above the floating action
    // buttons (z-30), which would otherwise sit on top of it. While
    // fullscreen only the decorations go: the UA stylesheet sizes the
    // fullscreen element itself, and keeping it positioned avoids one in-flow
    // frame on the way out that would squeeze the list to nothing.
    innerClass = `${innerBase} absolute inset-y-0 right-0 z-40 w-[520px] max-w-full${
      fullscreen
        ? ""
        : " border-l border-border shadow-[-24px_0_48px_rgba(0,0,0,0.45)]"
    }`;
  } else {
    const outerBase = "fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm";
    outerClass =
      size === "small"
        ? `${outerBase} justify-center p-4 sm:p-6 md:p-10`
        : `${outerBase} p-2 sm:p-4 md:p-6`;
    innerClass = fullscreen
      ? `${innerBase} relative w-full`
      : `${innerBase} relative w-full rounded-xl border border-border shadow-2xl${
          size === "small" ? " max-w-4xl" : ""
        }`;
  }

  return (
    <div
      className={outerClass}
      onClick={isPeek ? undefined : onClose}
      role={isPeek ? undefined : "dialog"}
      aria-modal={isPeek ? undefined : "true"}
    >
      <div
        ref={containerRef}
        className={innerClass}
        onClick={(e) => e.stopPropagation()}
        role={isPeek ? "dialog" : undefined}
        data-presentation={presentation}
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
  presentation = "modal",
  onSetPresentation,
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
  presentation?: Presentation;
  onSetPresentation?: (next: Presentation) => void;
  t: TFunc;
}) {
  const isPeek = presentation === "peek";
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
        <span
          className="select-text truncate text-sm font-medium text-fg"
          title={title}
        >
          {title}
        </span>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        {/* Peek: one button back to the modal (at its remembered size).
            Modal: the size toggle, then the button over to the peek. */}
        {isPeek ? (
          onSetPresentation && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => onSetPresentation("modal")}
              aria-label={t("media.openAsModal")}
              title={t("media.openAsModal")}
            >
              <Maximize2 />
            </Button>
          )
        ) : (
          <>
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
            {onSetPresentation && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => onSetPresentation("peek")}
                aria-label={t("media.openAsPeek")}
                title={t("media.openAsPeek")}
              >
                <PanelRight />
              </Button>
            )}
          </>
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
