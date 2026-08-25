// Discovery queue. /discover. Picks random media matching the current filters and presents them one at a time,
// Steam-discovery-queue style: a large preview, meta, tags, inline rating, and actions.
// Overlays the list as a modal (like MediaDetail). No video autoplay; videos get
// a hover scrub preview (frame endpoint) gated by the hoverPreview preference.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Maximize2, Minimize2, RefreshCw, Sparkles, X } from "lucide-react";
import { api, events } from "@/ipc/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useWatchLater } from "@/hooks/useWatchLater";
import { syncFileRowAcrossCaches } from "@/lib/queryCache";
import { cn } from "@/lib/utils";
import type { FileRow } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { useI18n } from "@/i18n/I18nProvider";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { usePreferences } from "@/settings/PreferencesProvider";
import { NAV_BINDINGS, matchAny } from "@/settings/keybindings";
import {
  MODAL_SIZE_KEY,
  type ModalSize,
} from "@/routes/MediaDetail/MediaModal";
import { DiscoverCard } from "./DiscoverCard";
import { DiscoverModal } from "./DiscoverModal";
import {
  DISCOVER_FILTER_PARAM,
  QUEUE_SIZE,
  parseDiscoverFilter,
} from "./utils";

// The arrows overlay the card, so keep their disabled-hover background identical
// to the resting one (the primitive clears it, assuming arrows sit outside).
const ARROW_CLASS =
  "z-20 size-11 border-border/60 bg-bg/50 backdrop-blur-md disabled:hover:bg-bg/50";

// Remembers the last viewed queue position so returning from the detail page resumes there.
// Module-level (not state) because the component unmounts while the detail modal is open.
let savedPosition: { wsId: string; filterKey: string; index: number } | null =
  null;

export default function Discover() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const onClose = useCallback(() => navigate("/"), [navigate]);
  const discoverFilter = useMemo(
    () => parseDiscoverFilter(searchParams.get(DISCOVER_FILTER_PARAM)),
    [searchParams],
  );
  const filterParam = searchParams.get(DISCOVER_FILTER_PARAM) ?? undefined;
  const filterKey = useMemo(
    () => JSON.stringify(discoverFilter),
    [discoverFilter],
  );

  const status = useAppStatus();
  const mediaBase = status.data?.mediaBase ?? "";
  const wsId = status.data?.workspaceId ?? "";
  const queueKey = useMemo(
    () => ["files_random", wsId, discoverFilter] as const,
    [wsId, discoverFilter],
  );

  // Workspace labels for the per-card meta chip (cache shared with WorkspaceRail).
  const wsList = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  const wsNames = useMemo(
    () => new Map(wsList.data?.workspaces.map((w) => [w.id, w.label]) ?? []),
    [wsList.data],
  );

  // Watch Later membership for the card toggles. Shares the workspaces_list
  // cache with wsList above, so this costs no extra request.
  const watchLater = useWatchLater();
  // Points at the selected slide's toggle so the "w" shortcut can activate it
  // through the button itself (same mutation, toast, effect and disabled state).
  const activeWatchLaterRef = useRef<HTMLButtonElement>(null);

  // Keep the queue stable across remounts; reshuffle is explicit (the button below).
  const queue = useQuery({
    queryKey: queueKey,
    queryFn: () => api.filesRandom({ ...discoverFilter, limit: QUEUE_SIZE }),
    enabled: status.data?.ready ?? false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const items = queue.data ?? [];

  // Cache-bust thumbnail URLs after a regeneration (e.g. the user picked a new main
  // thumbnail from MediaDetail). Without this, the browser keeps showing the previous
  // <thumbsDir>/<id>.webp since the path itself didn't change.
  const [thumbVersion, setThumbVersion] = useState<Record<string, number>>({});
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void events
      .onThumbDone((event) => {
        const key = event.workspaceId
          ? `${event.workspaceId}:${event.id}`
          : String(event.id);
        setThumbVersion((v) => ({ ...v, [key]: (v[key] ?? 0) + 1 }));
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  const [embla, setEmbla] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (!embla) return;
    const sync = () => {
      const i = embla.selectedScrollSnap();
      setCurrent(i);
      savedPosition = { wsId, filterKey, index: i };
    };
    sync();
    embla.on("select", sync);
    embla.on("reInit", sync);
    return () => {
      embla.off("select", sync);
      embla.off("reInit", sync);
    };
  }, [embla, filterKey, wsId]);

  // Capture the restore target on the very first render, before the carousel's initial
  // "select" event overwrites savedPosition with index 0.
  const restoreTargetRef = useRef(savedPosition);
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!embla || restoredRef.current || items.length === 0) return;
    restoredRef.current = true;
    const target = restoreTargetRef.current;
    if (target && target.wsId === wsId && target.filterKey === filterKey) {
      const idx = Math.min(target.index, items.length - 1);
      if (idx > 0) embla.scrollTo(idx, true); // jump (no animation)
    }
  }, [embla, filterKey, items.length, wsId]);

  const reshuffling = useRef(false);
  const reshuffle = useCallback(async () => {
    if (reshuffling.current) return;
    reshuffling.current = true;
    try {
      await queue.refetch();
      embla?.scrollTo(0, true);
    } finally {
      reshuffling.current = false;
    }
  }, [queue, embla]);

  // Carousel paging via the keyboard. Reuses the prev/next chords of the active
  // preset (vim h/l, normal [ ], emacs C-b/C-f); arrows always work as a fallback.
  // "r" reshuffles, "w" toggles Watch Later on the current card.
  // Esc / backdrop close is handled by DiscoverModal.
  const { keybindingPreset } = usePreferences();
  const nav = NAV_BINDINGS[keybindingPreset];
  useEffect(() => {
    if (!embla) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (e.code === "KeyR" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        void reshuffle();
        return;
      }
      if (e.code === "KeyW" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        activeWatchLaterRef.current?.click();
        return;
      }
      if (matchAny(e, nav.prev) || e.code === "ArrowLeft") {
        e.preventDefault();
        embla.scrollPrev();
        return;
      }
      if (matchAny(e, nav.next) || e.code === "ArrowRight") {
        e.preventDefault();
        embla.scrollNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embla, nav, reshuffle]);

  // Rating during discovery updates the queue card and the detail cache.
  const setRating = useMutation({
    mutationFn: ({
      id,
      workspaceId,
      rating,
    }: {
      id: number;
      workspaceId: string;
      rating: number;
    }) => api.fileSetRating(id, workspaceId, rating),
    onSuccess: (_d, { id, workspaceId, rating }) => {
      qc.setQueryData<FileRow[]>(queueKey, (old) =>
        old?.map((f) =>
          f.id === id && f.workspaceId === workspaceId ? { ...f, rating } : f,
        ),
      );
      syncFileRowAcrossCaches(qc, workspaceId, id, { rating });
    },
  });

  // Favorite toggling on cards is handled by the shared FavoriteButton, whose
  // cache sync patches every ["files_random"]-prefixed query including this
  // queue (no reshuffle) plus the list / detail caches.

  // Modal size toggle; the persisted value is shared with MediaDetail's modal.
  const [modalSize, setModalSize] = useLocalStorage<ModalSize>(
    MODAL_SIZE_KEY,
    "large",
    (raw) => (raw === "small" ? "small" : "large"),
  );
  const toggleModalSize = useCallback(
    () => setModalSize((prev) => (prev === "small" ? "large" : "small")),
    [setModalSize],
  );
  const isSmall = modalSize === "small";
  const sizeToggleLabel = isSmall
    ? t("media.modalMaximize")
    : t("media.modalMinimize");

  const ready = status.data?.ready ?? false;
  const loading = queue.isLoading && ready;

  return (
    <DiscoverModal onClose={() => void onClose()} size={modalSize}>
      {/* Header overlaid on the media; empty header space clicks through to the card. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-2.5 px-4 py-3">
        <Sparkles className="size-4 text-primary drop-shadow-md" />
        <span className="text-sm font-semibold text-bright-fg drop-shadow-md">
          {t("discover.title")}
        </span>
        {items.length > 0 && (
          <span className="text-xs tabular-nums text-muted drop-shadow-md">
            {t("discover.progress", {
              current: current + 1,
              total: items.length,
            })}
          </span>
        )}
        <div className="pointer-events-auto ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-border/60 bg-bg/50 px-2.5 backdrop-blur-md"
            onClick={() => void reshuffle()}
            disabled={loading || queue.isFetching}
          >
            <RefreshCw className={queue.isFetching ? "animate-spin" : ""} />
            {t("discover.reshuffle")}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8 border-border/60 bg-bg/50 backdrop-blur-md"
            onClick={toggleModalSize}
            aria-label={sizeToggleLabel}
            aria-pressed={isSmall}
            title={sizeToggleLabel}
          >
            {isSmall ? <Maximize2 /> : <Minimize2 />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8 border-border/60 bg-bg/50 backdrop-blur-md"
            onClick={() => void onClose()}
            title={`${t("common.close")} (Esc)`}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="h-full w-full">
        {loading ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
            <Sparkles className="size-10 opacity-50" />
            <p>{t("discover.empty")}</p>
            <p className="text-xs">{t("discover.emptyHint")}</p>
          </div>
        ) : (
          <Carousel
            className="h-full w-full"
            opts={{ loop: false, align: "center" }}
            setApi={setEmbla}
          >
            <CarouselContent containerClassName="h-full" className="ml-0 h-full">
              {items.map((f, i) => (
                <CarouselItem
                  key={`${f.workspaceId}:${f.id}`}
                  className="h-full pl-0"
                >
                  <DiscoverCard
                    file={f}
                    mediaBase={mediaBase}
                    thumbVersion={thumbVersion[`${f.workspaceId}:${f.id}`] ?? 0}
                    onRate={(rating) =>
                      setRating.mutate({
                        id: f.id,
                        workspaceId: f.workspaceId,
                        rating,
                      })
                    }
                    watchLater={watchLater}
                    watchLaterRef={
                      i === current ? activeWatchLaterRef : undefined
                    }
                    filterParam={filterParam}
                    workspaceName={wsNames.get(f.workspaceId)}
                    isActive={i === current}
                    t={t}
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className={cn("left-3", ARROW_CLASS)} />
            <CarouselNext className={cn("right-3", ARROW_CLASS)} />
          </Carousel>
        )}
      </div>
    </DiscoverModal>
  );
}
