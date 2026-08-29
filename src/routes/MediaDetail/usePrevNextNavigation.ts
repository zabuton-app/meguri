import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMediaNav } from "@/components/MediaNavContext";
import { usePreferences } from "@/settings/PreferencesProvider";
import {
  NAV_BINDINGS,
  matchAny,
  type NavBinding,
} from "@/settings/keybindings";

interface Args {
  fileId: number;
  wsId: string;
  /** Currently displayed file's kind. Affects arrow-key behavior (images use arrows for prev/next). */
  kind: string | undefined;
}

interface Result {
  goPrev: () => void;
  goNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  navBinding: NavBinding;
}

/**
 * Prev / next file navigation within the list order the user is browsing.
 *
 * Handles:
 * - Walking backwards/forwards through the shared list (MediaNavContext)
 * - Fetching the next page when the user steps past the loaded tail
 * - Prefetching ahead so stepping stays seamless
 * - Keyboard chords (preset bindings always; arrows for images, since videos seek with arrows)
 */
export function usePrevNextNavigation({ fileId, wsId, kind }: Args): Result {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { keybindingPreset } = usePreferences();
  const navBinding = NAV_BINDINGS[keybindingPreset];
  const nav = useMediaNav();
  const navItems = useMemo(() => nav?.items ?? [], [nav?.items]);
  const index = useMemo(
    () =>
      navItems.findIndex((it) => it.id === fileId && it.workspaceId === wsId),
    [navItems, fileId, wsId],
  );
  const prevItem = index > 0 ? navItems[index - 1] : null;
  const nextItem =
    index >= 0 && index < navItems.length - 1 ? navItems[index + 1] : null;
  const canPrev =
    !!prevItem || (index === 0 && (nav?.hasPreviousPage ?? false));
  const canNext =
    !!nextItem ||
    (index >= 0 &&
      index === navItems.length - 1 &&
      (nav?.hasNextPage ?? false));

  const goTo = useCallback(
    (target: { id: number; workspaceId: string } | null) => {
      if (!target) return;
      const params = new URLSearchParams();
      params.set("ws", target.workspaceId);
      const from = searchParams.get("from");
      // Paging to another file leaves the playlist behind: the player's parked
      // pass is on the file we arrived with, so handing it back after the user
      // has walked off it would resume somewhere they no longer are.
      if (from && from !== "player") params.set("from", from);
      const filter = searchParams.get("filter");
      if (filter) params.set("filter", filter);
      void navigate(`/file/${target.id}?${params.toString()}`);
    },
    [navigate, searchParams],
  );

  const goPrev = useCallback(() => {
    if (prevItem) {
      goTo(prevItem);
      return;
    }
    if (index === 0 && nav?.hasPreviousPage) {
      pendingPrev.current = true;
      nav.fetchPreviousPage();
    }
  }, [prevItem, goTo, index, nav]);
  const pendingNext = useRef(false);
  const pendingPrev = useRef(false);
  const goNext = useCallback(() => {
    if (nextItem) {
      goTo(nextItem);
      return;
    }
    if (index >= 0 && nav?.hasNextPage) {
      pendingNext.current = true;
      nav.fetchNextPage();
    }
  }, [nextItem, goTo, index, nav]);

  useEffect(() => {
    pendingNext.current = false;
    pendingPrev.current = false;
  }, [fileId]);

  useEffect(() => {
    if (pendingNext.current && nextItem) {
      pendingNext.current = false;
      goTo(nextItem);
    }
  }, [nextItem, goTo]);

  useEffect(() => {
    if (pendingPrev.current && prevItem) {
      pendingPrev.current = false;
      goTo(prevItem);
    }
  }, [prevItem, goTo]);

  useEffect(() => {
    if (
      index >= 0 &&
      index >= navItems.length - 3 &&
      nav?.hasNextPage &&
      !nav.isFetchingNextPage
    ) {
      nav.fetchNextPage();
    }
  }, [index, navItems.length, nav]);

  useEffect(() => {
    if (
      index >= 0 &&
      index <= 2 &&
      nav?.hasPreviousPage &&
      !nav.isFetchingPreviousPage
    ) {
      nav.fetchPreviousPage();
    }
  }, [index, nav]);

  const kindRef = useRef<string | undefined>(kind);
  const goPrevRef = useRef(goPrev);
  const goNextRef = useRef(goNext);
  const navBindingRef = useRef(navBinding);
  // Sync the latest values into refs (written after commit, not during render).
  useEffect(() => {
    kindRef.current = kind;
    goPrevRef.current = goPrev;
    goNextRef.current = goNext;
    navBindingRef.current = navBinding;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      const b = navBindingRef.current;
      if (matchAny(e, b.prev)) {
        e.preventDefault();
        goPrevRef.current();
        return;
      }
      if (matchAny(e, b.next)) {
        e.preventDefault();
        goNextRef.current();
        return;
      }
      if (kindRef.current === "image") {
        if (e.code === "ArrowLeft") {
          e.preventDefault();
          goPrevRef.current();
        } else if (e.code === "ArrowRight") {
          e.preventDefault();
          goNextRef.current();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Handlers go through refs above, so registering once is enough.
  }, []);

  return { goPrev, goNext, canPrev, canNext, navBinding };
}
