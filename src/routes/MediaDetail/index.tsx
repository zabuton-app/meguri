// File detail + player. /file/:id. Plays via local HTTP serving, offers external-player launch,
// tag editing, rating, and metadata display. Single-column YouTube-like layout: a large
// player on top, title/controls right below, then meta, tags, scenes, and history stacked as cards.
//
// This file composes the route. The pieces live beside it: where closing lands
// (useCloseTarget), modal / side peek / full screen (useDetailPresentation),
// every write to the file (useDetailMutations), audio in the bottom bar
// (useAudioDetail), prev/next (usePrevNextNavigation), and the title row,
// rating/tags card and play history as components.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { applyTagFilter } from "@/lib/ui-events";
import { api, ALL_ID, COLLECTION_ID_PREFIX } from "@/ipc/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchLater } from "@/hooks/useWatchLater";
import { useWatchLaterHotkey } from "@/hooks/useWatchLaterHotkey";
import { useRecordImageView } from "@/hooks/useRecordImageView";
import { useSpectrumPatternHotkey } from "@/audio/useSpectrumPatternHotkey";
import { useI18n } from "@/i18n/I18nProvider";
import { formatChords } from "@/settings/keybindings";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { MediaModal, TopBar } from "./MediaModal";
import { VideoPlayer, type PlayerHandle } from "./VideoPlayer";
import { useAudioActions } from "@/audio/useAudioPlayer";
import { hasThumbFile, thumbUrl } from "@/lib/thumbUrl";
import { AudioCompact, AudioStage } from "./AudioStage";
import { DetailActions } from "./DetailActions";
import { PlayHistory } from "./PlayHistory";
import { RatingTagsCard } from "./RatingTagsCard";
import { useAudioDetail } from "./useAudioDetail";
import { useCloseTarget } from "./useCloseTarget";
import { useDetailMutations } from "./useDetailMutations";
import { useDetailPresentation } from "./useDetailPresentation";
import { useThumbVersion } from "./useThumbVersion";
import { Scenes } from "./Scenes";
import { SceneBookmarks } from "./SceneBookmarks";
import { MetaChips } from "./MetaChips";
import { usePrevNextNavigation } from "./usePrevNextNavigation";
import {
  dropFromWatchLaterCache,
  invalidateCollectionSearches,
  invalidatePlayedSearches,
} from "@/lib/queryCache";

const IMAGE_BG_INVERTED_KEY = "meguri.image.backgroundInverted";

export default function MediaDetail() {
  const { t } = useI18n();
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
  const { pause: pauseAudio } = useAudioActions();
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

  // Total duration for scenes/history. Falls back to the natively obtained value when the DB duration is empty.
  const [nativeDur, setNativeDur] = useState<number | null>(null);
  const [imageBgInverted, setImageBgInverted] = useLocalStorage<boolean>(
    IMAGE_BG_INVERTED_KEY,
    false,
    (raw) => raw === "1",
  );
  // Handle for calling the player's seek from a scene click.
  const playerRef = useRef<PlayerHandle>(null);
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

  const thumbVersion = useThumbVersion(fileId, wsId);

  const detail = useQuery({
    queryKey: ["file_get", wsId, fileId],
    queryFn: () => api.fileGet(fileId, wsId),
    enabled: Number.isFinite(fileId) && wsId !== "",
  });
  const kind = detail.data?.kind;
  const {
    modalSize,
    toggleModalSize,
    presentation,
    setPresentation,
    isPeek,
    modalRef,
    isFullscreen,
  } = useDetailPresentation({ kind });
  // Viewing an image counts as a play (images have no player to fire onPlay),
  // so it shows up in the play history like videos do.
  useRecordImageView({
    wsId,
    fileId,
    kind,
    // The recorded ids, not this render's: prev/next may have moved on by
    // the time the main process confirms, and it is the viewed image that
    // has left Watch Later.
    onRecorded: (recordedWs, recordedId) => {
      // Keep the played/unplayed list filter in sync (same as VideoPlayer's onPlayed).
      invalidatePlayedSearches(qc);
      // Viewing an image counts as a play, so the main process just consumed
      // this file's Watch Later entry. Mirror that into the cache.
      dropFromWatchLaterCache(qc, recordedWs, recordedId);
    },
  });
  const workspaces = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  const collections = workspaces.data?.collections ?? [];
  // Watch Later membership for the toggle next to the favorite heart, plus the
  // "W" shortcut that drives that same control.
  const watchLater = useWatchLater();
  const watchLaterRef = useRef<HTMLButtonElement>(null);
  useWatchLaterHotkey({ active: true, buttonRef: watchLaterRef });
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
  const { onClose, openPlaylist } = useCloseTarget({
    fileId,
    wsId,
    startAt,
    playerRef,
    mediaSrc,
  });

  // Bar suppression, auto-start and video↔audio exclusivity for audio files.
  const {
    isAudio,
    claimPlayback,
    closeIfCurrent: closeAudioIfCurrent,
  } = useAudioDetail({
    file: detail.data ?? undefined,
    wsId,
    mediaBase,
    autoplay,
    startAt,
    pauseVideo: () => playerRef.current?.pause(),
    // The peek ends above the bar, so the bar stays — and for audio it is the
    // transport, the compact tile in the sheet having none.
    suppressBar: !isPeek,
  });
  // V / Shift+V step the spectrum pattern while an audio track is on screen
  // (the modal and the side peek alike; the playlist player binds it too).
  useSpectrumPatternHotkey(isAudio);

  const actions = useDetailMutations({
    fileId,
    wsId,
    onIndexEntryRemoved: closeAudioIfCurrent,
    onDeleteFinished: onClose,
    pauseVideo: () => playerRef.current?.pause(),
    // Only when the bar's track *is* this file; a different track playing
    // under a video detail is none of the external player's business.
    pauseAudio: isAudio ? pauseAudio : undefined,
  });

  const toggleImageBgInverted = useCallback(() => {
    setImageBgInverted((prev) => !prev);
  }, [setImageBgInverted]);

  // Reset the total duration when switching files — not on mount, where a
  // player adopting a handed-over <video> has already reported the duration
  // from its layout effect and this would erase it.
  // Resetting the total duration when switching files is a legitimate prop-change initialization, so synchronous setState is allowed.
  const nativeDurFileRef = useRef(fileId);
  useEffect(() => {
    if (nativeDurFileRef.current === fileId) return;
    nativeDurFileRef.current = fileId;
    setNativeDur(null);
  }, [fileId]);

  const { goPrev, goNext, canPrev, canNext, hasList, inList, navBinding } =
    usePrevNextNavigation({
      fileId,
      wsId,
      kind,
    });
  // The way into the playlist from here (see useCloseTarget). Offered only
  // while a list is mounted underneath, and only for a file that list has
  // loaded — the queue is built from that list, and a file it does not hold
  // (opened from the bottom bar after the list moved on) would leave the
  // player starting somewhere else.
  const canOpenPlaylist = inList;

  const d = detail.data;

  // Cover art is served from the thumbnail slot; audio without embedded art is
  // 'done' with no file behind it (see FileRow.hasThumb), so key on both.
  const coverSrc =
    d != null && isAudio && hasThumbFile(d)
      ? thumbUrl(mediaBase, wsId, fileId, thumbVersion)
      : null;

  if (detail.isLoading) {
    return (
      <MediaModal
        onClose={onClose}
        size={modalSize}
        presentation={presentation}
        t={t}
      >
        <TopBar
          onClose={onClose}
          size={modalSize}
          onToggleSize={toggleModalSize}
          presentation={presentation}
          onSetPresentation={setPresentation}
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
      <MediaModal
        onClose={onClose}
        size={modalSize}
        presentation={presentation}
        t={t}
      >
        <TopBar
          onClose={onClose}
          size={modalSize}
          onToggleSize={toggleModalSize}
          presentation={presentation}
          onSetPresentation={setPresentation}
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
      presentation={presentation}
      fullscreen={isFullscreen}
      containerRef={modalRef}
      t={t}
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
          onOpenPlaylist={hasList ? openPlaylist : undefined}
          canOpenPlaylist={canOpenPlaylist}
          size={modalSize}
          onToggleSize={toggleModalSize}
          presentation={presentation}
          onSetPresentation={setPresentation}
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
                bookmarkPending={actions.pending.bookmark}
                onAddBookmark={actions.addBookmark}
                onRemoveBookmark={actions.removeBookmark}
                exportPending={actions.pending.export}
                onExportFrame={actions.exportFrame}
                onNativeDuration={setNativeDur}
                onPlayed={() => {
                  invalidatePlayedSearches(qc);
                  dropFromWatchLaterCache(qc, wsId, fileId);
                }}
                onOpenExternal={() => dropFromWatchLaterCache(qc, wsId, fileId)}
                // Video demands attention, background audio yields. Pause rather
                // than close, so the bar stays visible and the user can resume.
                onPlaybackStart={claimPlayback}
                t={t}
              />
            </div>
          ) : d.kind === "audio" ? (
            // In the peek the bottom bar stays on screen as the transport, so
            // the sheet shows the track as a tile rather than a second stage.
            isPeek ? (
              <AudioCompact
                file={d}
                wsId={wsId}
                mediaBase={mediaBase}
                coverSrc={coverSrc}
              />
            ) : (
              <AudioStage
                file={d}
                wsId={wsId}
                mediaBase={mediaBase}
                coverSrc={coverSrc}
              />
            )
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
          <DetailActions
            detail={d}
            basename={basename}
            dir={dir}
            fileId={fileId}
            wsId={wsId}
            mediaSrc={mediaSrc}
            collections={collections}
            imageBgInverted={imageBgInverted}
            onToggleImageBg={toggleImageBgInverted}
            onOpenExternal={actions.openExternal}
            onDeleteFromIndex={() => void actions.deleteFromIndex()}
            onAddToCollection={actions.addToCollection}
            onRemoveFromCollection={actions.removeFromCollection}
            t={t}
          />

          {/* Scenes: evenly spaced thumbnails. Click to seek to that position. */}
          {d.kind === "video" && total && (
            <Scenes
              id={fileId}
              total={total}
              mediaBase={mediaBase}
              wsId={wsId}
              thumbOffsetSec={d.thumbOffsetSec}
              pendingThumbSec={actions.pendingThumbSec}
              // Status alone, not hasThumbFile: a video marked done always has
              // a frame behind it, and the scene picker shows the slot itself.
              mainThumbUrl={
                d.thumbStatus === "done"
                  ? thumbUrl(mediaBase, wsId, fileId, thumbVersion)
                  : null
              }
              mainThumbPending={actions.pending.mainThumb}
              onSeek={(sec) => playerRef.current?.seek(sec)}
              onSetMainThumb={actions.setMainThumb}
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
              pendingThumbSec={actions.pendingThumbSec}
              onSeek={(sec) => playerRef.current?.seek(sec)}
              onRemove={actions.removeBookmark}
              onSetMainThumb={actions.setMainThumb}
              t={t}
            />
          )}

          {/* Rating + tags */}
          <RatingTagsCard
            detail={d}
            fileId={fileId}
            wsId={wsId}
            watchLater={watchLater}
            watchLaterRef={watchLaterRef}
            onRate={actions.setRating}
            onAddTag={actions.addTag}
            onRemoveTag={actions.removeTag}
            onTagClick={onTagFilter}
            t={t}
          />

          {/* Metadata chips */}
          <MetaChips
            detail={d}
            wsId={wsId}
            workspaceLabel={owningWorkspace?.label ?? null}
            workspacePath={owningWorkspace?.path ?? null}
            total={total}
            t={t}
          />

          <PlayHistory history={d.playHistory} t={t} />
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
