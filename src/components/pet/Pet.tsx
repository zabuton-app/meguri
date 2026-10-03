// The pet: a pixel-art zabuton that lives in the window. It wanders along the
// floor (the bottom edge of the list), can be dragged and dropped, reacts to
// clicks, file drags and scans, and doubles as an entry point to Discover,
// the playlist and Watch Later.
//
// Mounted in Home, below the routed modals in the stacking order: a modal's
// backdrop covers it, and `active` then pauses everything it does.
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Clock,
  EyeOff,
  Gift,
  PlayCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { WATCH_LATER_ID } from "@shared/workspaceIds";
import { api, collectionTarget, events } from "@/ipc/client";
import type { FileRow } from "@/ipc/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { usePreferences } from "@/settings/PreferencesProvider";
import { useAddFilesToCollection } from "@/hooks/useAddFilesToCollection";
import { useFileDropTarget } from "@/hooks/useFileDropTarget";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useScanning } from "@/hooks/useScanning";
import { isFileDrag, type DraggedFile } from "@/lib/fileDrag";
import { fileHref } from "@/lib/fileHref";
import { playHref } from "@/lib/playHref";
import { parseQueueKey, queueKey } from "@/lib/playbackQueue";
import { invalidateWorkspaceScoped } from "@/lib/workspaceScope";
import { LIST_MAIN_ID } from "@/routes/Home/utils";
import { peekPass } from "@/routes/Player/detour";
import { BUBBLE_REACH, PetBubble } from "./PetBubble";
import { PetSprite } from "./PetSprite";
import { bringSomething, type BringCategory } from "./petBring";
import { displayState, INITIAL_PET_MODEL, reducePet } from "./petMachine";
import {
  clampToFloor,
  dragTo,
  isDrag,
  ratioFromX,
  stepFall,
  stepWalk,
  xFromRatio,
  type PetBody as Body,
  type PetFloor,
} from "./petMotion";
import { PET_SIZE_SCALE } from "./petSize";
import { PET_HEIGHT, PET_WIDTH } from "./petSprites";

const POSITION_KEY = "meguri.pet.x";
/** Where the pet stands until it has been moved: towards the left end. */
const DEFAULT_RATIO = 0.12;
/** Standing around this long (ms) between walks. */
const IDLE_MS = [3000, 8000] as const;
/** One walk lasts this long (ms), unless the floor ends first. */
const WALK_MS = [2000, 5000] as const;
/** Left alone this long (ms), the pet falls asleep instead of walking on. */
const SLEEP_AFTER_MS = 90_000;
/** The jump of a hop: its height in sprite pixels and its length (ms). */
const HOP_HEIGHT = 5;
const HOP_MS = 380;
/** Longest frame step (s): a throttled tab must not teleport the pet. */
const MAX_STEP = 0.05;

const BRING_LINES: Record<BringCategory, TranslationKey> = {
  watchLater: "pet.bringWatchLater",
  inProgress: "pet.bringInProgress",
  liked: "pet.bringLiked",
  unplayed: "pet.bringUnplayed",
};

function between([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

function loadRatio(): number {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_RATIO;
  } catch {
    return DEFAULT_RATIO;
  }
}

function saveRatio(ratio: number): void {
  try {
    localStorage.setItem(POSITION_KEY, ratio.toFixed(4));
  } catch {
    /* storage may be full or disabled; tolerate silently */
  }
}

/**
 * The floor is the bottom edge of the list: it sits above the status bar,
 * rises with the audio player bar, and its right end gives way to the docked
 * side peek — all of which resize the list itself.
 */
function measureFloor(): PetFloor {
  const rect = document.getElementById(LIST_MAIN_ID)?.getBoundingClientRect();
  if (!rect || rect.width === 0) {
    return { left: 0, right: window.innerWidth, y: window.innerHeight };
  }
  return { left: rect.left, right: rect.right, y: rect.bottom };
}

interface Bubble {
  /** Tells one bubble from the next, so each gets its full time on screen. */
  id: number;
  line: string;
  file: FileRow | null;
  shift: number;
}

export interface PetProps {
  /** The list is in the foreground: no routed modal covers the pet. */
  active: boolean;
  /** The list has something to play or discover. */
  hasPool: boolean;
  onDiscover: () => void;
}

// Home re-renders often (every batch of thumbnails during a scan); the pet
// only cares about its three props.
export const Pet = memo(function Pet(props: PetProps) {
  const { petVisible } = usePreferences();
  return petVisible ? <VisiblePet {...props} /> : null;
});

function subscribeToVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** False while the window is hidden (minimized, or closed to the tray). */
function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeToVisibility,
    () => document.visibilityState !== "hidden",
  );
}

function VisiblePet({ active: foreground, hasPool, onDiscover }: PetProps) {
  // Covered by a modal or out of sight, the pet rests: no timers, no frames.
  const pageVisible = usePageVisible();
  const active = foreground && pageVisible;
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { petSize, setPetVisible } = usePreferences();
  const reducedMotion = usePrefersReducedMotion();
  const scanning = useScanning();
  const scale = PET_SIZE_SCALE[petSize];
  const width = PET_WIDTH * scale;
  const height = PET_HEIGHT * scale;

  const [model, dispatch] = useReducer(reducePet, INITIAL_PET_MODEL);
  const [menuOpen, setMenuOpen] = useState(false);
  const [parkedKey, setParkedKey] = useState<string | null>(null);
  const [bubble, setBubble] = useState<Bubble | null>(null);

  // With reduced motion the pet does not walk: a walk under way reads as idle.
  const raw = displayState(model, scanning);
  const display = reducedMotion && raw === "walk" ? "idle" : raw;
  const folding = display === "fold";

  const rootRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLSpanElement>(null);
  const floor = useRef<PetFloor>({ left: 0, right: 0, y: 0 });
  const body = useRef<Body>({ x: 0, lift: 0, vy: 0 });
  const ratio = useRef(DEFAULT_RATIO);
  // Held or falling: the floor moving under it must not snap it back down.
  const airborne = useRef(false);
  const lastTouch = useRef(0);
  const press = useRef<{
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    dragging: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const hopJump = useRef<Animation | null>(null);
  const bubbleId = useRef(0);

  const touch = () => {
    lastTouch.current = Date.now();
  };

  const place = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const { x, lift } = body.current;
    const top = floor.current.y - height - lift;
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(top)}px, 0)`;
  }, [height]);

  /** Remember where the pet came to rest. */
  const settle = useCallback(() => {
    ratio.current = ratioFromX(floor.current, width, body.current.x);
    saveRatio(ratio.current);
  }, [width]);

  // Follow the floor: put the pet back on it at its saved ratio whenever the
  // list is resized, unless it is in the air.
  useLayoutEffect(() => {
    ratio.current = loadRatio();
    lastTouch.current = Date.now();
    let placed = false;
    const refloor = () => {
      // A walk only saves its ratio when it ends: take it from where the pet
      // is now, or a resize mid-walk would snap it back to where it set off.
      if (placed && !airborne.current) {
        ratio.current = ratioFromX(floor.current, width, body.current.x);
      }
      placed = true;
      floor.current = measureFloor();
      if (!airborne.current) {
        body.current = {
          x: xFromRatio(floor.current, width, ratio.current),
          lift: 0,
          vy: 0,
        };
      }
      place();
    };
    refloor();
    const main = document.getElementById(LIST_MAIN_ID);
    if (!main) {
      // No list to stand on: the window itself is the floor.
      window.addEventListener("resize", refloor);
      return () => window.removeEventListener("resize", refloor);
    }
    const observer = new ResizeObserver(refloor);
    observer.observe(main);
    return () => observer.disconnect();
  }, [width, place]);

  // The frame loop only runs while something moves: a fall or a walk.
  const moving = !active
    ? null
    : display === "fall"
      ? "fall"
      : display === "walk"
        ? "walk"
        : null;
  const dir = model.dir;
  useEffect(() => {
    if (!moving) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(MAX_STEP, (now - last) / 1000);
      last = now;
      if (moving === "fall") {
        const next = stepFall(body.current, dt, floor.current, width);
        body.current = { x: next.x, lift: next.lift, vy: next.vy };
        place();
        if (next.landed) {
          airborne.current = false;
          settle();
          dispatch({ type: "landed" });
          return;
        }
      } else {
        const next = stepWalk(
          body.current.x,
          dir,
          scale,
          dt,
          floor.current,
          width,
        );
        body.current.x = next.x;
        place();
        if (next.hitEdge) {
          dispatch({ type: "rest" });
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (moving === "walk") settle();
    };
  }, [moving, dir, scale, width, place, settle]);

  // Standing around, the pet wanders off after a while — or dozes off once
  // nobody has touched it for long enough.
  const quiet = active && display === "idle" && !menuOpen && bubble == null;
  useEffect(() => {
    if (!quiet) return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        // Reduced motion came on mid-walk: the walk is over as far as the
        // pet's own state goes, too.
        if (reducedMotion) dispatch({ type: "rest" });
        if (Date.now() - lastTouch.current > SLEEP_AFTER_MS) {
          dispatch({ type: "doze" });
        } else if (!reducedMotion) {
          const at = ratioFromX(floor.current, width, body.current.x);
          // Near an end of the floor, head back towards the middle.
          const towards =
            at < 0.2 ? 1 : at > 0.8 ? -1 : Math.random() < 0.5 ? 1 : -1;
          dispatch({ type: "wander", dir: towards });
        } else {
          schedule();
        }
      }, between(IDLE_MS));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [quiet, reducedMotion, width]);

  const walking = active && display === "walk";
  useEffect(() => {
    if (!walking) return;
    const timer = setTimeout(
      () => dispatch({ type: "rest" }),
      between(WALK_MS),
    );
    return () => clearTimeout(timer);
  }, [walking]);

  // A file drag anywhere in the window: the pet looks up with its mouth open.
  useEffect(() => {
    let dragging = false;
    const set = (next: boolean) => {
      if (dragging === next) return;
      dragging = next;
      dispatch({ type: "fileDrag", active: next });
    };
    const onEnter = (e: DragEvent) => {
      if (e.dataTransfer && isFileDrag(e.dataTransfer.types)) set(true);
    };
    const end = () => set(false);
    // dragend is lost when the dragged row unmounts mid-drag (the lists are
    // virtualized); no mousemove fires during a drag, so the first one after
    // it is the fallback.
    window.addEventListener("dragenter", onEnter, true);
    window.addEventListener("dragend", end, true);
    window.addEventListener("drop", end, true);
    window.addEventListener("mousemove", end);
    return () => {
      window.removeEventListener("dragenter", onEnter, true);
      window.removeEventListener("dragend", end, true);
      window.removeEventListener("drop", end, true);
      window.removeEventListener("mousemove", end);
    };
  }, []);

  // Scans and workspace switches. scan:progress fires many times a second,
  // so only the running state changing is passed on; thumb:done is ignored.
  useEffect(() => {
    let cancelled = false;
    const unlistens: Array<() => void> = [];
    const keep = (subscription: Promise<() => void>) =>
      void subscription.then((unlisten) => {
        if (cancelled) unlisten();
        else unlistens.push(unlisten);
      });
    let running = false;
    keep(
      events.onScanProgress(() => {
        if (running) return;
        running = true;
        dispatch({ type: "working", active: true });
      }),
    );
    keep(
      events.onScanDone((done) => {
        running = false;
        dispatch({ type: "working", active: false });
        // Nothing to cheer about when the scan failed or was called off.
        if (done.error || done.aborted) return;
        dispatch({ type: "react", reactions: ["cheer"] });
      }),
    );
    keep(
      events.onWorkspaceChanged(() =>
        dispatch({ type: "react", reactions: ["lookAround"] }),
      ),
    );
    return () => {
      cancelled = true;
      unlistens.forEach((unlisten) => unlisten());
    };
  }, []);

  // A hop's jump is a transform on the sprite alone: the button (the hit
  // area) stays on the floor, so the second click of a double-click lands.
  const seq = model.seq;
  useEffect(() => {
    if (display !== "hop" || reducedMotion) return;
    const el = spriteRef.current;
    if (!el || typeof el.animate !== "function") return;
    hopJump.current?.cancel();
    hopJump.current = el.animate(
      [
        { transform: "translateY(0)" },
        { transform: "translateY(0)", offset: 0.3, easing: "ease-out" },
        {
          transform: `translateY(${-HOP_HEIGHT * scale}px)`,
          offset: 0.65,
          easing: "ease-in",
        },
        { transform: "translateY(0)" },
      ],
      { duration: HOP_MS },
    );
  }, [display, seq, reducedMotion, scale]);

  const workspaces = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  const watchLater = workspaces.data?.collections.find(
    (c) => c.id === WATCH_LATER_ID,
  );
  const queued = useMemo(() => watchLater?.items ?? [], [watchLater?.items]);
  const members = useMemo(() => new Set(queued.map(queueKey)), [queued]);

  // Eating: files dropped on the pet go to Watch Later, the same write as
  // dropping them on the rail entry.
  const dropOnto = useAddFilesToCollection();
  const drop = useFileDropTarget((files: DraggedFile[]) => {
    touch();
    const fresh = files.some((f) => !members.has(queueKey(f)));
    dispatch({
      type: "react",
      reactions: fresh ? ["munch", "cheer"] : ["headShake"],
    });
    dropOnto(WATCH_LATER_ID, t("watchLater.name"))(files);
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || folding) return;
    const rect = e.currentTarget.getBoundingClientRect();
    press.current = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      dragging: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging) {
      if (!isDrag(e.clientX - p.startX, e.clientY - p.startY)) return;
      p.dragging = true;
      airborne.current = true;
      touch();
      setBubble(null);
      dispatch({ type: "grab" });
    }
    const next = dragTo(
      e.clientX - p.offsetX,
      e.clientY - p.offsetY,
      { width, height },
      window.innerWidth,
      floor.current,
    );
    body.current = { ...next, vy: 0 };
    place();
  };

  const onPointerUp = () => {
    const p = press.current;
    press.current = null;
    if (!p?.dragging) return;
    // The click that follows a drag's release is not a poke.
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const falls = body.current.lift > 0 && !reducedMotion;
    if (!falls) {
      // Nothing to fall through (or no motion wanted): straight to the floor.
      airborne.current = false;
      body.current = {
        x: clampToFloor(floor.current, width, body.current.x),
        lift: 0,
        vy: 0,
      };
      place();
      settle();
    }
    dispatch({ type: "release", airborne: falls });
  };

  const onClick = () => {
    if (suppressClick.current) return;
    touch();
    dispatch({ type: "react", reactions: ["hop"] });
  };

  const discover = () => {
    if (hasPool) onDiscover();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Enter") return;
    // Enter opens Discover instead of poking the pet, and stays clear of the
    // list's own keys.
    e.preventDefault();
    e.stopPropagation();
    discover();
  };

  const onMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (!open) return;
    touch();
    setParkedKey(peekPass()?.key ?? null);
    dispatch({ type: "rest" });
  };

  const resume = () => {
    const at = parseQueueKey(parkedKey);
    if (at) void navigate(playHref({ resume: at }));
  };

  // The player reads its order from the list, so playing Watch Later means
  // showing it first — which the rail's entry does the same way.
  const playWatchLater = async () => {
    try {
      if (!watchLater?.active) {
        await api.workspaceSwitch(collectionTarget(WATCH_LATER_ID));
        await invalidateWorkspaceScoped(qc);
      }
      void navigate("/play");
    } catch (e) {
      toast.error(t("pet.playWatchLaterFailed"), {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const say = (line: string, file: FileRow | null) => {
    const center = body.current.x + width / 2;
    const reach = Math.min(BUBBLE_REACH, window.innerWidth / 2);
    const kept = Math.min(Math.max(center, reach), window.innerWidth - reach);
    bubbleId.current += 1;
    setBubble({ id: bubbleId.current, line, file, shift: kept - center });
  };

  const bring = async () => {
    touch();
    try {
      const found = await bringSomething({
        filesRandom: api.filesRandom,
        watchLater: queued,
      });
      // Picked up while it was fetching: it has nothing to say in mid-air.
      if (airborne.current) return;
      if (found) {
        say(t(BRING_LINES[found.category]), found.file);
        dispatch({ type: "react", reactions: ["cheer"] });
      } else {
        say(t("pet.bringNothing"), null);
        dispatch({ type: "react", reactions: ["headShake"] });
      }
    } catch (e) {
      toast.error(t("pet.bringFailed"), {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const putAway = () => {
    setBubble(null);
    dispatch({ type: "react", reactions: ["fold"] });
  };

  const onSpriteDone = () => {
    if (!folding) {
      dispatch({ type: "reactionDone" });
      return;
    }
    setPetVisible(false);
    toast(t("pet.putAwayToast"), {
      action: {
        label: t("settings.title"),
        onClick: () => void navigate("/settings"),
      },
    });
  };

  return (
    <div
      ref={rootRef}
      data-pet=""
      inert={!foreground}
      className="fixed left-0 top-0 z-20 will-change-transform"
      style={{ width, height }}
    >
      <ContextMenu onOpenChange={onMenuOpenChange}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("pet.label")}
            title={t("pet.hint")}
            // No focus ring: it shows up around the pet whenever its menu
            // closes (focus returns here), framing a character, not a control.
            className="block size-full cursor-grab touch-none select-none outline-none active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            // Losing the capture without an up (the pet went inert under a
            // modal mid-drag) must not leave it held in mid-air.
            onLostPointerCapture={onPointerUp}
            onClick={onClick}
            onDoubleClick={discover}
            onKeyDown={onKeyDown}
            {...drop.handlers}
          >
            <span ref={spriteRef} className="block">
              <PetSprite
                key={`${display}:${seq}`}
                state={display}
                scale={scale}
                paused={!active}
                still={reducedMotion}
                onDone={onSpriteDone}
              />
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem disabled={!hasPool} onSelect={onDiscover}>
            <Sparkles />
            {t("discover.title")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!hasPool}
            onSelect={() => void navigate("/play")}
          >
            <PlayCircle />
            {t("pet.playList")}
          </ContextMenuItem>
          {parkedKey && (
            <ContextMenuItem onSelect={resume}>
              <RotateCcw />
              {t("pet.resume")}
            </ContextMenuItem>
          )}
          <ContextMenuItem
            disabled={queued.length === 0}
            onSelect={() => void playWatchLater()}
          >
            <Clock />
            {t("pet.playWatchLater")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void bring()}>
            <Gift />
            {t("pet.bring")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={putAway}>
            <EyeOff />
            {t("pet.putAway")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {bubble && (
        <PetBubble
          key={bubble.id}
          line={bubble.line}
          file={bubble.file}
          shift={bubble.shift}
          onOpen={(file) => {
            setBubble(null);
            void navigate(fileHref(file.id, file.workspaceId));
          }}
          onClose={() => setBubble(null)}
        />
      )}
    </div>
  );
}
