// File detail + player. /file/:id. Plays via local HTTP serving, offers external-player launch,
// tag editing, rating, and metadata display. Single-column YouTube-like layout: a large
// player on top, title/controls right below, then meta, tags, scenes, and history stacked as cards.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  type InfiniteData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ChevronDown,
  Contrast,
  Copy,
  ExternalLink,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  ImageDown,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  LIST_HIDDEN_SOURCES,
  RESERVED_TAG_ERROR,
  reservedTagPrefix,
} from "@shared/tags";
import { applyTagFilter } from "@/lib/ui-events";
import { api, events, ALL_ID, COLLECTION_ID_PREFIX } from "@/ipc/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import type { FileDetail, FileRow, SearchResult } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { RatingStars } from "@/components/RatingStars";
import { FavoriteButton } from "@/components/FavoriteButton";
import { TagEditor } from "@/components/TagEditor";
import { useI18n } from "@/i18n/I18nProvider";
import { formatChords } from "@/settings/keybindings";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  MediaModal,
  MODAL_SIZE_KEY,
  TopBar,
  type ModalSize,
} from "./MediaModal";
import { VideoPlayer, type PlayerHandle } from "./VideoPlayer";
import { Scenes } from "./Scenes";
import { SceneBookmarks } from "./SceneBookmarks";
import { MetaChips } from "./MetaChips";
import { usePrevNextNavigation } from "./usePrevNextNavigation";
import { copyImageToClipboard } from "./utils";
import {
  invalidateCollectionSearches,
  invalidatePlayedSearches,
  invalidateTagSearches,
  patchFileRowInCaches,
  syncFileRowAcrossCaches,
} from "@/lib/queryCache";

const IMAGE_BG_INVERTED_KEY = "meguri.image.backgroundInverted";

export default function MediaDetail() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { id } = useParams();
  const fileId = Number(id);
  // Optional initial seek position (seconds), e.g. when arriving from a Discovery scene click.
  const [searchParams] = useSearchParams();
  const startAt = Number(searchParams.get("t")) || 0;
  // `?autoplay=0` opts out of automatic playback (e.g. when entering from a
  // file-name click). Any other value (including omission) keeps the default
  // auto-play behavior.
  const autoplay = searchParams.get("autoplay") !== "0";
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Closing the modal = drop the child route. Return to Discovery if we came from there,
  // otherwise back to the list (the list stays mounted underneath).
  // Filtering the library by a tag only makes sense with the library visible, so
  // this closes the detail — to `/` rather than back to Discovery, since Discovery
  // has no notion of the list's filter.
  const onTagFilter = useCallback(
    (qualifiedName: string) => {
      applyTagFilter([qualifiedName]);
      void navigate("/");
    },
    [navigate],
  );

  const onClose = useCallback(() => {
    if (searchParams.get("from") !== "discover") {
      void navigate("/");
      return;
    }
    const params = new URLSearchParams();
    const filter = searchParams.get("filter");
    if (filter) params.set("filter", filter);
    const query = params.toString();
    void navigate(query ? `/discover?${query}` : "/discover");
  }, [navigate, searchParams]);

  // Total duration for scenes/history. Falls back to the natively obtained value when the DB duration is empty.
  const [nativeDur, setNativeDur] = useState<number | null>(null);
  const [imageBgInverted, setImageBgInverted] = useLocalStorage<boolean>(
    IMAGE_BG_INVERTED_KEY,
    false,
    (raw) => raw === "1",
  );
  const [modalSize, setModalSize] = useLocalStorage<ModalSize>(
    MODAL_SIZE_KEY,
    "large",
    (raw) => (raw === "small" ? "small" : "large"),
  );
  const toggleModalSize = useCallback(
    () => setModalSize((prev) => (prev === "small" ? "large" : "small")),
    [setModalSize],
  );
  // Handle for calling the player's seek from a scene click.
  const playerRef = useRef<PlayerHandle>(null);
  // The modal panel is the fullscreen target (YouTube-style: video fills the
  // screen, the rest of the detail content scrolls below it).
  const modalRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () =>
      setIsFullscreen(document.fullscreenElement === modalRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);
  const status = useAppStatus();
  // The file's owning workspace: from "?ws=" (set by every list/grid link, required in "All"
  // and collection views), falling back to the active workspace ID for single-workspace
  // navigation. The active ID is only a usable fallback when it's a real workspace — the
  // "All"/collection sentinels aren't resolvable Cores, so ignore them here.
  const activeId = status.data?.workspaceId ?? "";
  const activeFallback =
    activeId &&
    activeId !== ALL_ID &&
    !activeId.startsWith(COLLECTION_ID_PREFIX)
      ? activeId
      : "";
  const wsId = searchParams.get("ws") ?? activeFallback;

  // Cache-bust the on-page main-thumbnail preview after regeneration. The main process
  // emits `thumb:done` once ffmpeg finishes; bumping the version flips the `?v=` query
  // and forces the browser to refetch the rewritten WebP.
  const [thumbVersion, setThumbVersion] = useState(0);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void events
      .onThumbDone((event) => {
        if (
          event.id === fileId &&
          (!event.workspaceId || event.workspaceId === wsId)
        ) {
          setThumbVersion((v) => v + 1);
        }
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [fileId, wsId]);

  const detail = useQuery({
    queryKey: ["file_get", wsId, fileId],
    queryFn: () => api.fileGet(fileId, wsId),
    enabled: Number.isFinite(fileId) && wsId !== "",
  });
  // Exit fullscreen when prev/next lands on an image: the image view has no
  // fullscreen toggle, so staying fullscreen would strand the user (Esc only).
  // Keyed on the resolved kind ("image"), not on !video, so the transient
  // undefined while the next file loads doesn't drop video→video fullscreen.
  const kind = detail.data?.kind;
  useEffect(() => {
    if (kind === "image" && document.fullscreenElement === modalRef.current) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [kind]);
  // Viewing an image counts as a play (images have no player to fire onPlay),
  // so it shows up in the play history like videos do. The ref dedupes the
  // refetches/re-renders of a single visit; prev/next to a different file and
  // back records again, which matches "each view is a play".
  const recordedViewRef = useRef<string | null>(null);
  useEffect(() => {
    if (kind !== "image" || !wsId || !Number.isFinite(fileId)) {
      // Once the viewer settles on a non-image, drop the guard so navigating
      // back to the same image (e.g. image → video → image) records a new
      // view. Keep it while kind is still undefined (the next file loading)
      // so a transient fetch state can't cause double records.
      if (kind !== undefined) recordedViewRef.current = null;
      return;
    }
    const key = `${wsId}:${fileId}`;
    if (recordedViewRef.current === key) return;
    recordedViewRef.current = key;
    api
      .fileRecordPlay(fileId, wsId, "browser")
      .then(() => {
        // Keep the played/unplayed list filter in sync (same as VideoPlayer's onPlayed).
        invalidatePlayedSearches(qc);
      })
      .catch(() => {
        // Drop the guard on failure so a later effect run of this visit can retry;
        // without this a transient IPC error would suppress the record for good.
        if (recordedViewRef.current === key) recordedViewRef.current = null;
      });
  }, [kind, fileId, wsId, qc]);
  const workspaces = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  const collections = workspaces.data?.collections ?? [];
  // Opening a file drops it from Watch Later in the main process, but the main
  // process deliberately stays quiet about it so the list doesn't shift while
  // the user is stepping through it with prev/next. Flush the affected caches
  // once, when the detail view closes — this component stays mounted across
  // prev/next, so by then every file viewed this session has left the list.
  //
  // Done unconditionally rather than only when the file looked like a Watch
  // Later entry: the only evidence available here is the workspaces_list cache,
  // which may already have been refetched *after* the main process removed the
  // entry, leaving no trace that it was ever there. Guessing from it silently
  // skips the flush and strands the viewed file in the list. The cost is one
  // refetch on close, and invalidateCollectionSearches only touches
  // collection-scoped searches, not the workspace lists.
  useEffect(() => {
    return () => {
      void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
      invalidateCollectionSearches(qc);
    };
  }, [qc]);
  const owningWorkspace = useMemo(
    () => workspaces.data?.workspaces.find((w) => w.id === wsId) ?? null,
    [workspaces.data?.workspaces, wsId],
  );
  // Serve via the local HTTP server (Chromium's <video> can handle http+Range).
  const mediaBase = status.data?.mediaBase ?? "";
  // Include the workspace ID in the URL path (/ws/<id>/...) to avoid collisions with another DB after switching.
  const mediaSrc =
    mediaBase && wsId ? `${mediaBase}/ws/${wsId}/media/${fileId}` : "";

  const setRating = useMutation({
    mutationFn: (r: number) => api.fileSetRating(fileId, wsId, r),
    onSuccess: (_d, r) => {
      syncFileRowAcrossCaches(qc, wsId, fileId, { rating: r });
    },
  });
  // After a tag edit, refetch the canonical detail (tag names are normalized
  // server-side) and mirror its tags into the list caches, instead of
  // refetching every page of every list. Only searches whose membership
  // depends on tags (tag filter / text query) are invalidated.
  const onTagsChanged = async () => {
    try {
      const fresh = await qc.fetchQuery({
        queryKey: ["file_get", wsId, fileId],
        queryFn: () => api.fileGet(fileId, wsId),
      });
      if (fresh) {
        // FileRow omits pipeline sources (see attachTags); patching straight from
        // the detail response would put them back into the list caches.
        patchFileRowInCaches(qc, wsId, fileId, {
          tags: fresh.tags.filter(
            (tag) => !LIST_HIDDEN_SOURCES.includes(tag.source),
          ),
        });
      }
    } catch {
      // The tag edit itself succeeded; if the refetch fails (transient IPC
      // error), fall back to invalidating the detail so it reloads lazily.
      void qc.invalidateQueries({ queryKey: ["file_get", wsId, fileId] });
    }
    invalidateTagSearches(qc);
    void qc.invalidateQueries({ queryKey: ["tags_list_all"] });
  };
  const addTag = useMutation({
    mutationFn: (name: string) => api.fileAddTag(fileId, wsId, name),
    onSuccess: onTagsChanged,
    onError: (error, name) => {
      // main rejects a name that impersonates a pipeline-owned namespace; any
      // other failure (DB error, unknown workspace) deserves its own message.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(RESERVED_TAG_ERROR)) {
        toast.error(
          t("tags.addFailedReserved", {
            prefix: reservedTagPrefix(name) ?? name,
          }),
        );
      } else {
        toast.error(t("tag.addFailed"), { description: message });
      }
    },
  });
  const removeTag = useMutation({
    mutationFn: (tagId: number) => api.fileRemoveTag(fileId, wsId, tagId),
    onSuccess: onTagsChanged,
  });
  const deleteFromIndex = useMutation({
    mutationFn: () => api.fileDeleteFromIndex(fileId, wsId),
  });
  const invalidateCollections = () => {
    void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
    // Membership changes only affect collection-scoped lists, not workspace lists.
    invalidateCollectionSearches(qc);
  };
  const onCollectionError = (error: unknown) => {
    toast.error(t("collection.actionFailed"), {
      description: error instanceof Error ? error.message : String(error),
    });
  };
  const addToCollection = useMutation({
    mutationFn: (c: { id: string; name: string }) =>
      api.collectionAddFile(c.id, fileId, wsId),
    onSuccess: (_data, c) => {
      invalidateCollections();
      toast.success(t("collection.addedToast", { name: c.name }));
    },
    onError: onCollectionError,
  });
  const removeFromCollection = useMutation({
    mutationFn: (c: { id: string; name: string }) =>
      api.collectionRemoveFile(c.id, fileId, wsId),
    onSuccess: (_data, c) => {
      invalidateCollections();
      toast.success(t("collection.removedFromToast", { name: c.name }));
    },
    onError: onCollectionError,
  });
  const addBookmark = useMutation({
    mutationFn: (sec: number) => api.bookmarkAdd(fileId, wsId, sec),
    onSuccess: (created) => {
      if (!created) return;
      qc.setQueryData<FileDetail | null>(["file_get", wsId, fileId], (old) =>
        old
          ? {
              ...old,
              bookmarks: [
                ...old.bookmarks.filter((b) => b.id !== created.id),
                created,
              ].sort((a, b) => a.sec - b.sec || a.id - b.id),
            }
          : old,
      );
    },
  });
  const removeBookmark = useMutation({
    mutationFn: (bookmarkId: number) =>
      api.bookmarkRemove(fileId, wsId, bookmarkId),
    onSuccess: (_void, bookmarkId) => {
      qc.setQueryData<FileDetail | null>(["file_get", wsId, fileId], (old) =>
        old
          ? {
              ...old,
              bookmarks: old.bookmarks.filter((b) => b.id !== bookmarkId),
            }
          : old,
      );
    },
  });
  const setMainThumb = useMutation({
    // `sec=null` reverts to the auto-extracted frame.
    mutationFn: (sec: number | null) => api.thumbSetOffset(fileId, wsId, sec),
    // Snap the highlighted star to the chosen scene immediately; if ffmpeg fails the
    // backend throws and we roll back so the UI doesn't lie about the saved offset.
    onMutate: async (sec) => {
      await qc.cancelQueries({ queryKey: ["file_get", wsId, fileId] });
      const prev = qc.getQueryData<FileDetail | null>([
        "file_get",
        wsId,
        fileId,
      ]);
      qc.setQueryData<FileDetail | null>(["file_get", wsId, fileId], (old) =>
        old ? { ...old, thumbOffsetSec: sec } : old,
      );
      return { prev };
    },
    onError: (_err, _sec, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData(["file_get", wsId, fileId], ctx.prev);
      }
    },
    onSuccess: (res) => {
      // Reconcile to the server-confirmed value (in case clamping happened).
      // List/grid thumbnails refresh via the `thumb:done` event from the main process —
      // no manual cache surgery needed for ["files_search"]/["files_random"].
      qc.setQueryData<FileDetail | null>(["file_get", wsId, fileId], (old) =>
        old ? { ...old, thumbOffsetSec: res.thumbOffsetSec } : old,
      );
    },
  });

  const exportFrame = useMutation({
    mutationFn: (sec: number) => api.frameExport(fileId, wsId, sec),
    onSuccess: (res) => {
      // A canceled save dialog resolves with saved=false — stay silent.
      if (res.saved) toast.success(t("player.frameExported"));
    },
    onError: () => toast.error(t("player.frameExportFailed")),
  });

  const handleDeleteFromIndex = async () => {
    const ok = await confirm({
      title: t("media.deleteFromIndex"),
      message: t("media.deleteFromIndexConfirm"),
      confirmText: t("media.deleteFromIndex"),
      destructive: true,
    });
    if (!ok) return;
    const deleted = await deleteFromIndex.mutateAsync();
    qc.setQueriesData<InfiniteData<SearchResult>>(
      { queryKey: ["files_search"] },
      (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.filter(
                  (item) => item.id !== deleted.id || item.workspaceId !== wsId,
                ),
              })),
            }
          : old,
    );
    qc.setQueriesData<FileRow[]>({ queryKey: ["files_random"] }, (old) =>
      old?.filter(
        (item) => item.id !== deleted.id || item.workspaceId !== wsId,
      ),
    );
    qc.removeQueries({ queryKey: ["file_get", wsId, deleted.id] });
    void qc.invalidateQueries({ queryKey: ["files_search"] });
    void qc.invalidateQueries({ queryKey: ["files_random"] });
    onClose();
  };

  const toggleImageBgInverted = useCallback(() => {
    setImageBgInverted((prev) => !prev);
  }, [setImageBgInverted]);

  // Reset the total duration when switching files.
  // Resetting the total duration when switching files is a legitimate prop-change initialization, so synchronous setState is allowed.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNativeDur(null), [fileId]);

  const { goPrev, goNext, canPrev, canNext, navBinding } =
    usePrevNextNavigation({
      fileId,
      wsId,
      kind: detail.data?.kind,
    });

  const d = detail.data;

  if (detail.isLoading) {
    return (
      <MediaModal onClose={onClose} size={modalSize}>
        <TopBar
          onClose={onClose}
          size={modalSize}
          onToggleSize={toggleModalSize}
          t={t}
        />
        <div className="flex w-full flex-col gap-4 px-4 py-4">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </MediaModal>
    );
  }
  if (!d) {
    return (
      <MediaModal onClose={onClose} size={modalSize}>
        <TopBar
          onClose={onClose}
          size={modalSize}
          onToggleSize={toggleModalSize}
          t={t}
        />
        <Centered>{t("media.notFound")}</Centered>
      </MediaModal>
    );
  }

  const total = d.duration && d.duration > 0 ? d.duration : (nativeDur ?? null);
  const slash = d.relPath.lastIndexOf("/");
  const basename = slash >= 0 ? d.relPath.slice(slash + 1) : d.relPath;
  const dir = slash >= 0 ? d.relPath.slice(0, slash) : "";

  return (
    <MediaModal
      onClose={onClose}
      size={modalSize}
      fullscreen={isFullscreen}
      containerRef={modalRef}
    >
      {!isFullscreen && (
        <TopBar
          onClose={onClose}
          title={basename}
          onPrev={goPrev}
          onNext={goNext}
          canPrev={canPrev}
          canNext={canNext}
          prevHint={formatChords(navBinding.prev)}
          nextHint={formatChords(navBinding.next)}
          size={modalSize}
          onToggleSize={toggleModalSize}
          t={t}
        />
      )}

      <ScrollArea className="page-scroll min-h-0 flex-1">
        <div className="flex w-full flex-col gap-4 px-4 py-4">
          {/* Player / viewer */}
          {d.kind === "video" ? (
            // In fullscreen, cancel the surrounding padding so the video is
            // edge-to-edge for the first screenful (the rest scrolls below).
            <div className={isFullscreen ? "-mx-4 -mt-4" : "contents"}>
              <VideoPlayer
                ref={playerRef}
                id={fileId}
                src={mediaSrc}
                duration={d.duration}
                width={d.width}
                height={d.height}
                mediaBase={mediaBase}
                wsId={wsId}
                startAt={startAt}
                autoplay={autoplay}
                navKeys={navBinding}
                fullscreenTargetRef={modalRef}
                bookmarks={d.bookmarks}
                bookmarkPending={
                  addBookmark.isPending || removeBookmark.isPending
                }
                onAddBookmark={(sec) => addBookmark.mutate(sec)}
                onRemoveBookmark={(bookmarkId) =>
                  removeBookmark.mutate(bookmarkId)
                }
                exportPending={exportFrame.isPending}
                onExportFrame={(sec) => exportFrame.mutate(sec)}
                onNativeDuration={setNativeDur}
                onPlayed={() => invalidatePlayedSearches(qc)}
                t={t}
              />
            </div>
          ) : (
            <div
              className={`flex justify-center overflow-hidden rounded-xl ${
                imageBgInverted ? "bg-white" : "bg-black"
              }`}
            >
              <img
                src={mediaSrc}
                alt={d.relPath}
                className="max-h-[78vh] max-w-full object-contain"
              />
            </div>
          )}

          {/* Title + controls */}
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1
                className="truncate text-lg font-semibold text-bright-fg"
                title={d.relPath}
              >
                {basename}
              </h1>
              {dir && (
                <p className="truncate text-xs text-muted" title={d.relPath}>
                  {dir}
                </p>
              )}
            </div>
            <ButtonGroup className="shrink-0">
              {d.kind === "image" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-muted/35 bg-surface px-2"
                    onClick={toggleImageBgInverted}
                    aria-label={t("media.invertImageBackground")}
                    aria-pressed={imageBgInverted}
                    title={t("media.invertImageBackground")}
                  >
                    <Contrast />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-muted/35 bg-surface px-2"
                    disabled={!mediaSrc}
                    onClick={() => {
                      if (!mediaSrc) return;
                      void copyImageToClipboard(mediaSrc)
                        .then(() => toast.success(t("media.imageCopied")))
                        .catch((e: unknown) => {
                          console.error("copy image failed:", e);
                          toast.error(t("media.imageCopyFailed"));
                        });
                    }}
                    aria-label={t("media.copyImage")}
                    title={t("media.copyImage")}
                  >
                    <ImageDown />
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className="border-muted/35 bg-surface"
                onClick={() => {
                  playerRef.current?.pause();
                  void api.openExternal(fileId, wsId);
                }}
              >
                <ExternalLink />
                {t("media.openExternal")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-muted/35 bg-surface px-2"
                    aria-label={t("media.moreActions")}
                  >
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-44 border border-muted/35 bg-surface p-0"
                >
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      className="rounded-none px-3 py-2 text-xs"
                      onSelect={() => void api.openFolder(fileId, wsId)}
                    >
                      <FolderOpen />
                      {t("media.openFolder")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="mx-0 my-0 bg-muted/35" />
                    <DropdownMenuItem
                      className="rounded-none px-3 py-2 text-xs"
                      onSelect={() => void api.copyFilePath(fileId, wsId)}
                    >
                      <Copy />
                      {t("media.copyFilePath")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="mx-0 my-0 bg-muted/35" />
                    <DropdownMenuItem
                      className="rounded-none px-3 py-2 text-xs text-error data-[highlighted]:text-error"
                      onSelect={() => void handleDeleteFromIndex()}
                    >
                      <Trash2 />
                      {t("media.deleteFromIndex")}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>

            {/* Collection actions: kept as a standalone dropdown, independent of the
                open-external/more-actions button group. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 border-muted/35 bg-surface px-2"
                  aria-label={t("collection.addToMenu")}
                  title={t("collection.addToMenu")}
                >
                  <FolderPlus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-44 border border-muted/35 bg-surface p-0"
              >
                <DropdownMenuGroup>
                  {/* Kept as a guard for a not-yet-loaded/failed workspaces_list
                      query. In practice the list is never empty at rest: the
                      built-in Watch Later collection is always seeded, and it
                      shows up in this menu like any other collection. */}
                  {collections.length === 0 ? (
                    <DropdownMenuItem
                      disabled
                      className="rounded-none px-3 py-2 text-xs"
                    >
                      <FolderPlus />
                      {t("collection.empty")}
                    </DropdownMenuItem>
                  ) : (
                    collections.map((collection) => {
                      const included = collection.items.some(
                        (item) =>
                          item.workspaceId === wsId && item.fileId === fileId,
                      );
                      return (
                        <DropdownMenuItem
                          key={collection.id}
                          className="rounded-none px-3 py-2 text-xs"
                          onSelect={() =>
                            included
                              ? removeFromCollection.mutate(collection)
                              : addToCollection.mutate(collection)
                          }
                        >
                          {included ? <FolderMinus /> : <FolderPlus />}
                          {included
                            ? t("collection.removeFrom", {
                                name: collection.name,
                              })
                            : t("collection.addTo", { name: collection.name })}
                        </DropdownMenuItem>
                      );
                    })
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Scenes: evenly spaced thumbnails. Click to seek to that position. */}
          {/* Only the scene currently being applied (sec or null = revert) should look busy;
              previously the whole row greyed out, which felt like the page had frozen. */}
          {d.kind === "video" && total && (
            <Scenes
              id={fileId}
              total={total}
              mediaBase={mediaBase}
              wsId={wsId}
              thumbOffsetSec={d.thumbOffsetSec}
              pendingThumbSec={
                setMainThumb.isPending
                  ? (setMainThumb.variables ?? null)
                  : undefined
              }
              mainThumbUrl={
                d.thumbStatus === "done" && mediaBase && wsId
                  ? `${mediaBase}/ws/${wsId}/thumb/${fileId}?v=${thumbVersion}`
                  : null
              }
              mainThumbPending={setMainThumb.isPending}
              onSeek={(sec) => playerRef.current?.seek(sec)}
              onSetMainThumb={(sec) => setMainThumb.mutate(sec)}
              t={t}
            />
          )}

          {/* User-curated scene bookmarks. Hidden when empty (the player has a button to add one). */}
          {d.kind === "video" && d.bookmarks.length > 0 && (
            <SceneBookmarks
              id={fileId}
              bookmarks={d.bookmarks}
              mediaBase={mediaBase}
              wsId={wsId}
              thumbOffsetSec={d.thumbOffsetSec}
              pendingThumbSec={
                setMainThumb.isPending
                  ? (setMainThumb.variables ?? null)
                  : undefined
              }
              onSeek={(sec) => playerRef.current?.seek(sec)}
              onRemove={(bookmarkId) => removeBookmark.mutate(bookmarkId)}
              onSetMainThumb={(sec) => setMainThumb.mutate(sec)}
              t={t}
            />
          )}

          {/* Rating + tags */}
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs font-semibold uppercase text-muted">
                {t("media.rating")}
              </span>
              <RatingStars
                value={d.rating}
                onChange={(r) => setRating.mutate(r)}
                size={20}
              />
              <FavoriteButton
                fileId={fileId}
                workspaceId={wsId}
                favorite={d.favorite}
                size={22}
                className="ml-auto"
              />
            </div>
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-xs font-semibold uppercase text-muted">
                {t("media.tags")}
              </span>
              <TagEditor
                tags={d.tags}
                workspaceId={wsId}
                onAdd={(name) => addTag.mutate(name)}
                onRemove={(tagId) => removeTag.mutate(tagId)}
                onTagClick={onTagFilter}
              />
            </div>
          </div>

          {/* Metadata chips */}
          <MetaChips
            detail={d}
            wsId={wsId}
            workspaceLabel={owningWorkspace?.label ?? null}
            workspacePath={owningWorkspace?.path ?? null}
            total={total}
            t={t}
          />

          {/* Play history */}
          {d.playHistory.length > 0 && (
            <section className="rounded-xl border border-border bg-surface p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted">
                {t("media.playHistory")}
              </h3>
              <ul className="space-y-1 text-xs text-muted">
                {d.playHistory.slice(0, 8).map((p, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="tabular-nums text-fg">
                      {new Date(p.playedAt * 1000).toLocaleString()}
                    </span>
                    <Badge variant="outline" className="font-normal">
                      {p.via}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </ScrollArea>
    </MediaModal>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      {children}
    </div>
  );
}
