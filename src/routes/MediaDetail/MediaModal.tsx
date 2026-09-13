import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type Ref,
} from "react";
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
import { holdPeekDocked } from "./peekDocked";
import { LIST_MIN_WIDTH, PEEK_MIN_WIDTH, usePeekResize } from "./usePeekResize";

export type ModalSize = "large" | "small";

// How the detail view is presented: a modal over the whole window, or a side
// peek — a sheet docked to the right edge of the list area that leaves the
// list, the toolbar and the bottom player bar visible and usable.
export type Presentation = "modal" | "peek";

// Shared localStorage key: MediaDetail and Discover persist one common size.
export const MODAL_SIZE_KEY = "meguri.media.modalSize";
// Remembered separately from the size, so switching to the peek and back lands
// on the modal size that was last chosen.
// Detail-only (unlike MODAL_SIZE_KEY above), hence the `detail` segment.
export const PRESENTATION_KEY = "meguri.media.detail.presentation";

// Frame around the detail view. Close on Esc, and on backdrop click when there
// is a backdrop (the modal). `size` toggles the modal between a
// near-fullscreen layout ("large") and a centered compact panel ("small");
// `presentation: "peek"` renders the side sheet instead: an in-flow sibling
// of Home's list that takes its width from the row, so the list narrows and
// every part of it stays reachable. `containerRef` exposes the inner panel so
// the player can request fullscreen on the whole frame (YouTube-style);
// `fullscreen` drops the frame decorations while that element is the
// fullscreen element.
export function MediaModal({
  onClose,
  size = "large",
  presentation = "modal",
  fullscreen = false,
  containerRef,
  t,
  children,
}: {
  onClose: () => void;
  size?: ModalSize;
  presentation?: Presentation;
  fullscreen?: boolean;
  containerRef?: Ref<HTMLDivElement>;
  t: TFunc;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A popup on top (a Radix dropdown or popover, the confirm dialog)
        // takes the key for itself and marks it so; only an Esc nobody
        // claimed closes this view. Matters most in the peek, where the
        // list's own popups are in reach.
        if (e.defaultPrevented) return;
        // While in fullscreen, Esc exits fullscreen (browser default) — keep the modal open.
        if (document.fullscreenElement) return;
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPeek = presentation === "peek";
  const docked = isPeek && !fullscreen;

  // The panel element, for measuring and for live-resizing during a drag
  // without a render per pointer move (the parent's ref is served too).
  const panelRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(containerRef, () => panelRef.current as HTMLDivElement);
  const peek = usePeekResize(docked, panelRef);
  // Tell Home the list is in use beside the sheet (see peekDocked.ts).
  useLayoutEffect(() => {
    if (!docked) return;
    return holdPeekDocked();
  }, [docked]);

  // One tree shape for both presentations: only classes and ARIA change, so
  // switching modal ↔ peek re-styles the frame without remounting what is
  // inside it (a playing <video> keeps its position; a half-typed tag stays).
  // In the peek the outer div is `display: contents`, so the sheet is laid
  // out as a flex item of Home's list row. Position and width are set per
  // variant rather than in a shared base, so no utility of the base can
  // outrank a variant's (Tailwind orders the generated rules, not the class
  // string).
  const innerBase = "flex min-h-0 flex-col overflow-hidden bg-bg";
  let outerClass: string;
  let innerClass: string;
  if (isPeek) {
    outerClass = "contents";
    // No backdrop: the list stays interactive beside the sheet, which takes
    // its share of the row so the list narrows rather than being covered.
    // While fullscreen only the decorations go: the UA stylesheet sizes the
    // fullscreen element itself.
    innerClass = `${innerBase} relative shrink-0${
      fullscreen
        ? ""
        : " border-l border-border shadow-[-24px_0_48px_rgba(0,0,0,0.25)]"
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
        ref={panelRef}
        className={innerClass}
        // Inline rather than a Tailwind class: the ceiling is derived from
        // LIST_MIN_WIDTH, and a class built from it would not be scanned.
        style={
          docked
            ? {
                width: peek.width,
                maxWidth: `calc(100% - ${LIST_MIN_WIDTH}px)`,
              }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
        role={isPeek ? "dialog" : undefined}
        data-presentation={presentation}
      >
        {docked && (
          // Grab strip along the sheet's left edge. Wider than its 1px look
          // (the hit area extends past the border) so it is easy to catch.
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("media.peekResize")}
            aria-valuenow={peek.width}
            aria-valuemin={PEEK_MIN_WIDTH}
            aria-valuemax={Number.isFinite(peek.max) ? peek.max : undefined}
            tabIndex={0}
            title={t("media.peekResize")}
            onPointerDown={peek.onPointerDown}
            onKeyDown={peek.onKeyDown}
            className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
          />
        )}
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
