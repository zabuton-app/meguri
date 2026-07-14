// Discovery queue. /discover. Picks random media matching the current filters and presents them one at a time,
// Steam-discovery-queue style: a large preview, meta, tags, inline rating, and actions.
// Overlays the list as a modal (like MediaDetail). Static thumbnails (no autoplay).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles, X } from "lucide-react";
import { api, events } from "@/ipc/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { syncFileRowAcrossCaches } from "@/lib/queryCache";
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
import { usePreferences } from "@/settings/PreferencesProvider";
import { NAV_BINDINGS, matchAny } from "@/settings/keybindings";
import { DiscoverCard } from "./DiscoverCard";
import { DiscoverModal } from "./DiscoverModal";
import { SceneGrid } from "./SceneGrid";
import {
  DISCOVER_FILTER_PARAM,
  QUEUE_SIZE,
  parseDiscoverFilter,
} from "./utils";

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
  // "r" reshuffles. Esc / backdrop close is handled by DiscoverModal.
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

  // Favorite toggle. Patches the queue card in place (avoids reshuffling the
  // random queue) and keeps the list / detail caches in sync.
  const setFavorite = useMutation({
    mutationFn: ({
      id,
      workspaceId,
      favorite,
    }: {
      id: number;
      workspaceId: string;
      favorite: boolean;
    }) => api.fileSetFavorite(id, workspaceId, favorite),
    onSuccess: (_d, { id, workspaceId, favorite }) => {
      qc.setQueryData<FileRow[]>(queueKey, (old) =>
        old?.map((f) =>
          f.id === id && f.workspaceId === workspaceId
            ? { ...f, favorite: favorite ? 1 : 0 }
            : f,
        ),
      );
      syncFileRowAcrossCaches(qc, workspaceId, id, {
        favorite: favorite ? 1 : 0,
      });
    },
  });

  const ready = status.data?.ready ?? false;
  const loading = queue.isLoading && ready;
  const currentItem = items[current];

  return (
    <DiscoverModal onClose={() => void onClose()}>
      <header className="flex items-center gap-2 border-b border-border bg-bg px-3 py-2.5">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-medium text-fg">
          {t("discover.title")}
        </span>
        {items.length > 0 && (
          <span className="text-xs tabular-nums text-muted">
            {t("discover.progress", {
              current: current + 1,
              total: items.length,
            })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={() => void reshuffle()}
            disabled={loading || queue.isFetching}
          >
            <RefreshCw className={queue.isFetching ? "animate-spin" : ""} />
            {t("discover.reshuffle")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => void onClose()}
            title={`${t("common.close")} (Esc)`}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="grid h-full w-full content-start gap-4 p-4 px-10 sm:p-5 sm:px-12 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <div className="hidden flex-col gap-3 md:flex">
              <Skeleton className="h-6 w-3/4 rounded" />
              <Skeleton className="h-5 w-1/2 rounded" />
              <Skeleton className="h-16 w-full rounded" />
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
            <Sparkles className="size-10 opacity-50" />
            <p>{t("discover.empty")}</p>
            <p className="text-xs">{t("discover.emptyHint")}</p>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-3 p-4 sm:p-5">
            <Carousel
              className="w-full shrink-0"
              opts={{ loop: false, align: "center" }}
              setApi={setEmbla}
            >
              <CarouselContent>
                {items.map((f) => (
                  <CarouselItem key={f.id} className="px-10 sm:px-12">
                    <DiscoverCard
                      file={f}
                      mediaBase={mediaBase}
                      thumbVersion={
                        thumbVersion[`${f.workspaceId}:${f.id}`] ?? 0
                      }
                      onRate={(rating) =>
                        setRating.mutate({
                          id: f.id,
                          workspaceId: f.workspaceId,
                          rating,
                        })
                      }
                      onToggleFavorite={() =>
                        setFavorite.mutate({
                          id: f.id,
                          workspaceId: f.workspaceId,
                          favorite: !f.favorite,
                        })
                      }
                      filterParam={filterParam}
                      t={t}
                    />
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious className="left-1 size-9 bg-bg/80 backdrop-blur-sm sm:left-2" />
              <CarouselNext className="right-1 size-9 bg-bg/80 backdrop-blur-sm sm:right-2" />
            </Carousel>

            {/* Scene previews fill the remaining vertical space (taller windows show more rows). */}
            {currentItem &&
            currentItem.kind === "video" &&
            currentItem.duration &&
            currentItem.duration > 0 &&
            mediaBase &&
            currentItem.workspaceId ? (
              <SceneGrid
                id={currentItem.id}
                total={currentItem.duration}
                mediaBase={mediaBase}
                wsId={currentItem.workspaceId}
                filterParam={filterParam}
                className="min-h-0 flex-1"
              />
            ) : null}
          </div>
        )}
      </div>
    </DiscoverModal>
  );
}
