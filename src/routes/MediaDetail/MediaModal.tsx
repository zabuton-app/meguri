import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type Ref,
} from "react";
import {
  AppWindow,
  ChevronLeft,
  ChevronRight,
  EllipsisVertical,
  Maximize2,
  Minimize2,
  PanelRight,
  PlayCircle,
  PictureInPicture2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaFileName, FileExtensionBadge } from "@/components/MediaFileName";
import type { TFunc } from "@/i18n/I18nProvider";
import { holdPeekDocked } from "./peekDocked";
import { LIST_MIN_WIDTH, PEEK_MIN_WIDTH, usePeekResize } from "./usePeekResize";
import { useModalResize } from "./useModalResize";

export type ModalSize = "large" | "small";

// How the detail view is presented: a modal over the whole window, or a side
// peek — a sheet docked to the right edge of the list area that leaves the
// list, the toolbar and the bottom player bar visible and usable.
export type Presentation = "modal" | "peek";

// Legacy size key, still used by Discovery.
export const MODAL_SIZE_KEY = "meguri.media.modalSize";
// Detail starts compact once, including for people upgrading from the old
// near-fullscreen default. Discovery keeps its existing size preference.
export const DETAIL_MODAL_SIZE_KEY = "meguri.media.detail.modalSize.v2";
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
  detached = false,
  size = "small",
  presentation = "modal",
  fullscreen = false,
  containerRef,
  onResize,
  t,
  children,
}: {
  onClose: () => void;
  detached?: boolean;
  size?: ModalSize;
  presentation?: Presentation;
  fullscreen?: boolean;
  containerRef?: Ref<HTMLDivElement>;
  onResize?: () => void;
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

  const isPeek = !detached && presentation === "peek";
  const docked = isPeek && !fullscreen;

  // The panel element, for measuring and for live-resizing during a drag
  // without a render per pointer move (the parent's ref is served too).
  const panelRef = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);
  useImperativeHandle(containerRef, () => panelRef.current as HTMLDivElement);
  const peek = usePeekResize(docked, panelRef);
  const modal = useModalResize(
    !isPeek && !fullscreen && !detached,
    size,
    panelRef,
    onResize,
  );
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
  // The modal clips its content to its rounded corners; the peek must not
  // clip, or the grip that straddles its left edge loses its outer half.
  const innerBase = "flex min-h-0 flex-col bg-bg";
  let outerClass: string;
  let innerClass: string;
  if (detached) {
    outerClass = "contents";
    innerClass = `${innerBase} relative h-full w-full overflow-hidden`;
  } else if (isPeek) {
    outerClass = "contents";
    // No backdrop: the list stays interactive beside the sheet, which takes
    // its share of the row so the list narrows rather than being covered. A
    // plain rule marks the edge (a shadow would be re-rasterised on every
    // frame of a resize drag). While fullscreen only the decorations go: the
    // UA stylesheet sizes the fullscreen element itself.
    innerClass = `${innerBase} relative shrink-0${
      fullscreen ? "" : " border-l border-border"
    }`;
  } else {
    outerClass = "fixed inset-0 z-50 bg-black/40";
    innerClass = fullscreen
      ? `${innerBase} relative w-full overflow-hidden`
      : `${innerBase} absolute overflow-hidden rounded-xl border border-border shadow-2xl`;
  }

  return (
    <div
      className={outerClass}
      onPointerDownCapture={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // A drag that starts in the player can release over the backdrop.
        // Only a click that also started on the backdrop dismisses the player.
        if (
          !isPeek &&
          !detached &&
          pressedBackdrop.current &&
          event.target === event.currentTarget
        )
          onClose();
        pressedBackdrop.current = false;
      }}
      role={isPeek ? undefined : "dialog"}
      aria-modal={isPeek ? undefined : "true"}
    >
      <div
        ref={panelRef}
        data-slot="modal-panel"
        className={innerClass}
        // Inline rather than a Tailwind class: the ceiling is derived from
        // LIST_MIN_WIDTH, and a class built from it would not be scanned.
        style={
          docked
            ? {
                width: peek.width,
                maxWidth: `calc(100% - ${LIST_MIN_WIDTH}px)`,
              }
            : fullscreen || detached
              ? undefined
              : {
                  width: modal.width,
                  height: modal.height,
                  left: modal.left,
                  top: modal.top,
                }
        }
        onPointerDown={(e) => {
          if (
            isPeek ||
            fullscreen ||
            detached ||
            !(e.target instanceof Element)
          )
            return;
          if (
            e.target.closest("[data-player-title]") &&
            !e.target.closest("button,a,input,select,textarea")
          )
            modal.onPointerDown("move", e);
        }}
        onKeyDown={(e) => {
          if (
            !isPeek &&
            !fullscreen &&
            !detached &&
            e.target instanceof Element &&
            e.target.matches("[data-player-title]")
          )
            modal.onKeyDown("move", e);
        }}
        onClick={(e) => e.stopPropagation()}
        role={isPeek ? "dialog" : undefined}
        data-presentation={detached ? "window" : presentation}
      >
        {docked && (
          // Grab strip along the sheet's left edge. Wider than its 1px look
          // (the hit area extends past the border) so it is easy to catch,
          // with a grip glyph at mid-height to say it can be dragged.
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
            className="group/handle absolute inset-y-0 -left-1 z-10 flex w-2 cursor-col-resize items-center justify-center touch-none hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
          >
            <span
              aria-hidden
              className="flex h-6 w-4 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-muted group-hover/handle:border-primary group-hover/handle:text-fg group-focus-visible/handle:border-primary group-focus-visible/handle:text-fg"
            >
              <EllipsisVertical className="size-3.5" />
            </span>
          </div>
        )}
        {children}
        {!isPeek && !fullscreen && !detached && (
          <>
            {(["left", "right", "top", "bottom"] as const).map((edge) => {
              const horizontal = edge === "left" || edge === "right";
              const label = t(
                horizontal ? "media.resizeWidth" : "media.resizeHeight",
              );
              const position: Record<
                "left" | "right" | "top" | "bottom",
                string
              > = {
                left: "inset-y-2 left-0 w-2 cursor-col-resize",
                right: "inset-y-2 right-0 w-2 cursor-col-resize",
                top: "inset-x-2 top-0 h-2 cursor-row-resize",
                bottom: "inset-x-2 bottom-0 h-2 cursor-row-resize",
              };
              return (
                <div
                  key={edge}
                  role="separator"
                  aria-orientation={horizontal ? "vertical" : "horizontal"}
                  aria-label={label}
                  aria-valuenow={horizontal ? modal.width : modal.height}
                  aria-valuemin={Math.min(
                    horizontal ? 480 : 420,
                    horizontal ? modal.max.width : modal.max.height,
                  )}
                  aria-valuemax={
                    horizontal ? modal.max.width : modal.max.height
                  }
                  tabIndex={0}
                  title={label}
                  data-resize-edge={edge}
                  onPointerDown={(e) => modal.onPointerDown(edge, e)}
                  onKeyDown={(e) => modal.onKeyDown(edge, e)}
                  className={`absolute z-20 touch-none focus-visible:outline-2 focus-visible:outline-primary ${position[edge]}`}
                />
              );
            })}
            {(["topLeft", "topRight", "bottomLeft", "corner"] as const).map(
              (edge) => (
                <button
                  key={edge}
                  type="button"
                  aria-label={t("media.resizePlayer")}
                  title={t("media.resizePlayer")}
                  data-resize-edge={edge}
                  onPointerDown={(e) => modal.onPointerDown(edge, e)}
                  onKeyDown={(e) => modal.onKeyDown(edge, e)}
                  className={`absolute z-30 flex size-4 touch-none items-center justify-center text-muted focus-visible:outline-2 focus-visible:outline-primary ${edge === "topLeft" ? "left-0 top-0 cursor-nwse-resize" : edge === "topRight" ? "right-0 top-0 cursor-nesw-resize" : edge === "bottomLeft" ? "bottom-0 left-0 cursor-nesw-resize" : "bottom-0 right-0 cursor-nwse-resize"}`}
                >
                  {edge === "corner" && (
                    <span
                      aria-hidden
                      className="size-2 border-b-2 border-r-2 border-current"
                    />
                  )}
                </button>
              ),
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function TopBar({
  onClose,
  detached = false,
  title,
  onPrev,
  onNext,
  canPrev,
  canNext,
  prevHint,
  nextHint,
  onOpenPlaylist,
  canOpenPlaylist = true,
  onPopout,
  size,
  onToggleSize,
  presentation = "modal",
  onSetPresentation,
  t,
}: {
  onClose: () => void;
  detached?: boolean;
  title?: string;
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  prevHint?: string;
  nextHint?: string;
  /** Play the list from this file in the playlist player. Absent when there
   *  is no list to play. */
  onOpenPlaylist?: () => void;
  /** False while the list does not hold this file. */
  canOpenPlaylist?: boolean;
  onPopout?: () => void;
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
    <header
      data-player-title
      tabIndex={isPeek || detached ? undefined : 0}
      title={
        detached
          ? t("media.moveWindow")
          : isPeek
            ? undefined
            : t("media.movePlayer")
      }
      className={`flex shrink-0 items-center gap-2 border-b border-border bg-bg px-3 py-2.5 ${detached ? "player-native-title" : isPeek ? "" : "cursor-grab touch-none active:cursor-grabbing"}`}
    >
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
          className="flex min-w-0 select-text items-center gap-2 text-sm font-medium text-bright-fg"
          title={title}
        >
          <span className="min-w-0 truncate">
            <MediaFileName relPath={title} />
          </span>
          <FileExtensionBadge relPath={title} />
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {/* Not a toggle: this one leaves the detail view for the playlist,
            the way the player's own detail button leaves the playlist. */}
        {onOpenPlaylist && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onOpenPlaylist}
            disabled={!canOpenPlaylist}
            aria-label={t("media.playAsPlaylist")}
            title={t("media.playAsPlaylist")}
          >
            <PlayCircle />
          </Button>
        )}
        {onPopout && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onPopout}
            aria-label={t("media.popout")}
            title={t("media.popout")}
          >
            <PictureInPicture2 />
          </Button>
        )}
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
              <AppWindow />
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
