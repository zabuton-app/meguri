// Whether a card is being pointed at or has focus inside it: what its
// hover-only controls (selection box, favorite and Watch Later toggles, the
// drag-out handle, the editable stars) wait for before they are mounted.
//
// Those controls sit at opacity 0 on every card until it is hovered, and a
// scrolled grid mounts and lays out dozens of cards a frame: a fling spent
// more of each frame on the invisible controls (their DOM, their compositing
// effects, the mutation hooks behind them) than on what the cards show. So a
// card draws only what is visible until it is hovered or focused.
//
// Turning off waits a little longer than the controls' fade-out, so they fade
// out as before rather than vanishing; turning on is immediate, and focusing
// into the card (Tab onto its link) mounts them before the next Tab reaches
// them.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
} from "react";

/** Longer than the 150ms opacity transition of the controls. */
export const HOVER_RELEASE_MS = 200;

export interface HoverActivation {
  active: boolean;
  /** Spread onto the card's root element. */
  handlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: (e: FocusEvent<HTMLElement>) => void;
  };
}

export function useHoverActivation(): HoverActivation {
  const [active, setActive] = useState(false);
  const hovered = useRef(false);
  const focusWithin = useRef(false);
  const releaseTimer = useRef<number | null>(null);

  const cancelRelease = () => {
    if (releaseTimer.current !== null) {
      window.clearTimeout(releaseTimer.current);
      releaseTimer.current = null;
    }
  };
  const update = useCallback(() => {
    if (hovered.current || focusWithin.current) {
      cancelRelease();
      setActive(true);
      return;
    }
    releaseTimer.current ??= window.setTimeout(() => {
      releaseTimer.current = null;
      setActive(false);
    }, HOVER_RELEASE_MS);
  }, []);
  useEffect(() => cancelRelease, []);

  const [handlers] = useState(() => ({
    onMouseEnter: () => {
      hovered.current = true;
      update();
    },
    onMouseLeave: () => {
      hovered.current = false;
      update();
    },
    onFocus: () => {
      focusWithin.current = true;
      update();
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      // Focus moving between the card's own controls keeps it on.
      if (e.currentTarget.contains(e.relatedTarget)) return;
      focusWithin.current = false;
      update();
    },
  }));
  return { active, handlers };
}
