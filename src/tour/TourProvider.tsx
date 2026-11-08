// Runs the guided tours. driver.js dims the window and cuts out the element a
// step is about; what is said there comes from the pet (its bubble is drawn by
// Pet.tsx), or from a bubble at the bottom of the window while the pet is put
// away.
//
// A tour only starts on the bare list (Home with no routed modal on top),
// which Home reports through setHostReady. That is where every target lives.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import type { TranslationKey } from "@/i18n/locales/ja";
import { usePreferences } from "@/settings/PreferencesProvider";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  FEATURE_TOURS,
  FIRST_LAUNCH_TOUR_ID,
  findTour,
  tourSelector,
  type TourStep,
} from "./tours";
import {
  loadSeenTours,
  markTourSeen,
  nextPendingTour,
  saveSeenTours,
} from "./tourStore";
import { TourBubble } from "./TourBubble";

/** Pause after the list comes to the foreground, so the layout has settled. */
const START_DELAY_MS = 500;

export interface ActiveTourStep {
  title: TranslationKey;
  body: TranslationKey;
  picker?: TourStep["picker"];
  index: number;
  total: number;
}

interface TourContextValue {
  /** The step on screen, or null when no tour is running. */
  step: ActiveTourStep | null;
  next: () => void;
  prev: () => void;
  /** End the tour now. It counts as seen, the same as finishing it. */
  skip: () => void;
  /** Run the first-launch tour again, as soon as the list is in front. */
  replay: () => void;
  /** Home: whether the bare list is on screen, so a tour may run. */
  setHostReady: (ready: boolean) => void;
}

const noop = () => {};

// Outside a provider (component tests) there is never a tour.
const TourContext = createContext<TourContextValue>({
  step: null,
  next: noop,
  prev: noop,
  skip: noop,
  replay: noop,
  setHostReady: noop,
});

interface Running {
  steps: readonly TourStep[];
  index: number;
}

/**
 * A dialog or menu is open over the list (Home cannot see Radix's own: the
 * edit dialogs, confirmations, context menus). Starting under one would sink
 * it below the overlay and fight it for focus.
 */
function overlayOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
  );
}

function isOnScreen(step: TourStep): boolean {
  if (!step.target) return true;
  const el = document.querySelector(tourSelector(step.target));
  return !!el && el.getClientRects().length > 0;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { petVisible } = usePreferences();
  const reducedMotion = usePrefersReducedMotion();
  // Read during the first render, before the other providers' effects store
  // anything: an empty storage is how a first launch is told apart.
  const [seen, setSeen] = useState(loadSeenTours);
  const [requested, setRequested] = useState<string | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [running, setRunning] = useState<Running | null>(null);
  const driverRef = useRef<Driver | null>(null);
  // The running tour as the callbacks see it; `running` mirrors it for render.
  const tourRef = useRef<(Running & { tourId: string }) | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // driver.js only draws the overlay and its cut-out (highlight(), which adds
  // no popover of its own); which step is on screen is tracked here.
  const show = useCallback((index: number) => {
    const d = driverRef.current;
    const tour = tourRef.current;
    if (!d || !tour) return;
    const target = tour.steps[index].target;
    tour.index = index;
    d.highlight({ element: target ? tourSelector(target) : undefined });
    setRunning({ steps: tour.steps, index });
  }, []);

  const finish = useCallback(() => {
    const d = driverRef.current;
    const tour = tourRef.current;
    if (!d || !tour) return;
    driverRef.current = null;
    tourRef.current = null;
    d.destroy();
    setRunning(null);
    setSeen((prev) => {
      const next = markTourSeen(prev, tour.tourId, FEATURE_TOURS);
      saveSeenTours(next);
      return next;
    });
    returnFocus.current?.focus();
    returnFocus.current = null;
  }, []);

  const next = useCallback(() => {
    const tour = tourRef.current;
    if (!tour) return;
    if (tour.index < tour.steps.length - 1) show(tour.index + 1);
    else finish();
  }, [show, finish]);

  const prev = useCallback(() => {
    const tour = tourRef.current;
    if (tour && tour.index > 0) show(tour.index - 1);
  }, [show]);

  const replay = useCallback(() => setRequested(FIRST_LAUNCH_TOUR_ID), []);

  // Start the requested tour, or else the next one not seen yet, once the
  // list is in front.
  const pending = requested ?? nextPendingTour(seen, FEATURE_TOURS);
  useEffect(() => {
    if (!hostReady || running || !pending) return;
    let timer = 0;
    const tryStart = () => {
      if (overlayOpen()) {
        timer = window.setTimeout(tryStart, START_DELAY_MS);
        return;
      }
      const tour = findTour(pending);
      setRequested(null);
      if (!tour) return;
      const steps = tour.steps.filter(isOnScreen);
      if (steps.length === 0) return;
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      driverRef.current = driver({
        animate: !reducedMotion,
        // The keys and the buttons are ours (see below and TourBubble); the
        // overlay only shows where to look.
        allowKeyboardControl: false,
        allowClose: false,
        overlayClickBehavior: "none",
        disableActiveInteraction: true,
        overlayOpacity: 0.6,
        stagePadding: 6,
        stageRadius: 8,
      });
      tourRef.current = { tourId: tour.id, steps, index: 0 };
      show(0);
    };
    timer = window.setTimeout(tryStart, START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hostReady, running, pending, reducedMotion, show]);

  // The list left the front mid-tour (a route change the overlay could not
  // block): stop without counting the tour as seen, and ask for it again so
  // it picks up once the list is back — a replay included, which nothing
  // else would bring back.
  useEffect(() => {
    if (!running || hostReady) return;
    const tourId = tourRef.current?.tourId ?? null;
    driverRef.current?.destroy();
    driverRef.current = null;
    tourRef.current = null;
    returnFocus.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the host going away
    setRunning(null);
    if (tourId) setRequested(tourId);
  }, [running, hostReady]);

  // Tear the overlay down if the provider goes away mid-tour, without
  // counting the tour as seen.
  useEffect(
    () => () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    },
    [],
  );

  // While a tour runs it owns the keyboard: the list's own shortcuts must not
  // act on what is behind the overlay.
  const active = running != null;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const bubble = document.querySelector<HTMLElement>("[data-tour-bubble]");
      const inBubble =
        !!bubble && e.target instanceof Node && bubble.contains(e.target);
      // Immediate: other capture listeners on window registered after this
      // one must not see the key either.
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "Tab") {
        // Keep focus on the bubble's buttons.
        e.preventDefault();
        const buttons = bubble
          ? [...bubble.querySelectorAll<HTMLElement>("button:not(:disabled)")]
          : [];
        if (buttons.length === 0) return;
        const at = buttons.indexOf(document.activeElement as HTMLElement);
        const last = buttons.length - 1;
        const to =
          at === -1
            ? e.shiftKey
              ? last
              : 0
            : e.shiftKey
              ? at === 0
                ? last
                : at - 1
              : at === last
                ? 0
                : at + 1;
        buttons[to].focus();
      } else if (!inBubble) {
        // Enter / Space still press the focused button; nothing else gets
        // through to the app.
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, finish, next, prev]);

  const step = useMemo<ActiveTourStep | null>(() => {
    if (!running) return null;
    const s = running.steps[running.index];
    return {
      title: s.title,
      body: s.body,
      picker: s.picker,
      index: running.index,
      total: running.steps.length,
    };
  }, [running]);

  const value = useMemo<TourContextValue>(
    () => ({ step, next, prev, skip: finish, replay, setHostReady }),
    [step, next, prev, finish, replay],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {/* With the pet out, it does the talking: VisiblePet in Pet.tsx draws
          the bubble whenever petVisible is on (Home always mounts it). */}
      {step && !petVisible && <TourBubble placement="floating" />}
    </TourContext.Provider>
  );
}

export function useTour(): TourContextValue {
  return useContext(TourContext);
}
