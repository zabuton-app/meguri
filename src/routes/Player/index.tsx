// Full-screen playlist player. /play
//
// Plays the list the user is browsing — a collection, Watch Later, a workspace
// listing or a search result — one item after another with no input required.
// The order comes from MediaNavContext, so whatever sort and filter the list has
// is what plays, and the queue keeps growing as further pages load.
//
// This file composes the route: the queue, the stage and the control bar. The
// mechanics live beside it — item transitions (useStageTransition), audio in
// the bottom bar (usePlaylistAudio), keyboard control (usePlayerKeys), the
// control bar's idle timer (useChromeIdle), full screen (useFullscreen) and the
// pass parked for a detour to the detail view (detour.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { useExclusivePlayback } from "@/audio/useAudioPlayer";
import { useAppStatus } from "@/hooks/useAppStatus";
import { usePlaybackQueue } from "@/hooks/usePlaybackQueue";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useRecordImageView } from "@/hooks/useRecordImageView";
import { setVolume, toggleMuted, useVolume } from "@/hooks/useVolume";
import { usePreferences } from "@/settings/PreferencesProvider";
import { useTheme } from "@/themes/ThemeProvider";
import { cn } from "@/lib/utils";
import { NAV_BINDINGS } from "@/settings/keybindings";
import {
  invalidateCollectionSearches,
  invalidatePlayedSearches,
} from "@/lib/queryCache";
import { fileHref } from "@/lib/fileHref";
import { announceVideoHandOff } from "@/video/videoHandOff";
import { hasThumbFile, thumbUrl } from "@/lib/thumbUrl";
import { queueKey } from "@/lib/playbackQueue";
import { fileNameOf } from "@/lib/relPath";
import {
  VideoPlayer,
  type PlayerHandle,
} from "@/routes/MediaDetail/VideoPlayer";
import { AudioArt } from "./AudioArt";
import { claimPass, dropPass, parkPass } from "./detour";
import { ImageStage } from "./ImageStage";
import { SnapshotStage } from "./SnapshotStage";
import { enteringStyle, leavingStyle } from "./transition";
import { PlayerChrome } from "./PlayerChrome";
import { PlayerStage } from "./PlayerStage";
import { useChromeIdle, useWakeOnChange } from "./useChromeIdle";
import { useFullscreen } from "./useFullscreen";
import { usePlayerKeys } from "./usePlayerKeys";
import { usePlaylistAudio } from "./usePlaylistAudio";
import { useStageTransition } from "./useStageTransition";

/**
 * Half of one item-to-item transition: the outgoing item fades out over this
 * long, the swap happens at the bottom of the dip, and the incoming item fades
 * back in over the same span. Dipping through the stage's own ground rather than
 * cross-dissolving keeps exactly one video element alive at a time.
 */
const TRANSITION_MS = 260;

/**
 * Seconds into a video below which the detail view is opened from the start
 * instead. A `?t=` on a stream makes the server re-encode from that second, so
 * paying for it to land back where the file already begins is pure waste.
 */
const RESUME_MIN_SEC = 3;

export default function Player() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useI18n();
  const status = useAppStatus();
  const mediaBase = status.data?.mediaBase ?? "";
  const {
    playlistImageSeconds,
    playlistShuffle,
    playlistRepeat,
    playlistImageMotion,
    playlistFade,
    playlistTransition,
    keybindingPreset,
    setPlaylistShuffle,
    setPlaylistRepeat,
    audioSpectrum,
    setAudioSpectrum,
  } = usePreferences();
  const reducedMotion = usePrefersReducedMotion();
  // Plain black or plain white rather than the theme family's own background:
  // this is the ground a transparent image is composited onto, so it wants to be
  // the neutral extreme of the current appearance, not a tinted surface.
  const { mode } = useTheme();
  const ground = mode === "light" ? "bg-white" : "bg-black";
  const navBinding = NAV_BINDINGS[keybindingPreset];

  // Claimed on the first render, before the effect below empties the slot, and
  // only when the file named in the URL is the one the pass was parked on.
  const [searchParams] = useSearchParams();
  const [pickUp, setPickUp] = useState(() =>
    claimPass(searchParams.get("resume")),
  );
  useEffect(() => {
    dropPass();
  }, []);

  const queue = usePlaybackQueue({
    shuffle: playlistShuffle,
    repeat: playlistRepeat,
    restore: pickUp?.queue,
  });
  const { current, next, prev, skipCurrent } = queue;

  // Reduced motion turns switching effects off outright rather than merely
  // shortening them, as does turning both effects off by hand. Either way the
  // player still advances on exactly the same schedule.
  const animateSwap = !reducedMotion && (playlistFade || playlistTransition);
  const transitionMs = animateSwap ? TRANSITION_MS : 0;

  const [paused, setPaused] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

  // Shared with the detail view's player, so a level set in either place holds
  // for the other and survives both item switches and restarts.
  const { volume, muted } = useVolume();
  const videoRef = useRef<PlayerHandle>(null);
  // The playlist owns sound while it is open. A track left playing in the bottom
  // bar would otherwise keep going underneath a video or a picture — paused
  // rather than closed, so it is still there to resume after leaving the player.
  const { claim: claimPlayback } = useExclusivePlayback(() =>
    videoRef.current?.pause(),
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen, exitFullscreen } =
    useFullscreen(rootRef);

  const exit = useCallback(() => {
    exitFullscreen();
    void navigate("/");
  }, [exitFullscreen, navigate]);

  // Playing an item drops it from Watch Later in the main process, which stays
  // quiet about it so the list does not shift mid-playback. Flush the affected
  // caches once, on the way out — the same contract the detail view follows.
  useEffect(() => {
    return () => {
      void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
      invalidateCollectionSearches(qc);
    };
  }, [qc]);

  // Details for the item on screen (dimensions, duration, path).
  const detail = useQuery({
    queryKey: ["file_get", current?.workspaceId, current?.fileId],
    queryFn: () => api.fileGet(current!.fileId, current!.workspaceId),
    enabled: !!current,
  });
  const file = detail.data ?? null;
  const isImage = current?.kind === "image";
  const isAudio = current?.kind === "audio";
  const currentKey = current ? queueKey(current) : "";
  // Claimed per item, not once on mount: an audio item *is* the bar's sound,
  // so only a video or a picture takes it over.
  useEffect(() => {
    if (currentKey && !isAudio) claimPlayback();
  }, [currentKey, isAudio, claimPlayback]);

  // Step out to this file's detail view. The detail route is a sibling of this
  // one, so this always ends playback for now — what makes it a detour rather
  // than an exit is the pass parked in detour.ts and the `from=player` marker
  // the detail view reads when it closes.
  const openDetail = useCallback(() => {
    if (!current) return;
    const sec = isImage ? 0 : Math.floor(videoRef.current?.currentTime() ?? 0);
    parkPass({ queue: queue.queue, key: queueKey(current), sec });
    // The detail view shows this very file: hand it the playing <video> rather
    // than have it load its own and seek (see videoHandOff.ts). `t` stays as
    // the fallback for when the hand-off does not happen.
    if (current.kind === "video" && mediaBase)
      announceVideoHandOff(
        `${mediaBase}/ws/${current.workspaceId}/media/${current.fileId}`,
      );
    void navigate(
      fileHref(current.fileId, current.workspaceId, {
        from: "player",
        t: sec >= RESUME_MIN_SEC ? sec : undefined,
        // Audio keeps playing in the bar across the trip; the detail view must
        // neither restart it nor resume a track the user had paused here.
        autoplay: !isAudio,
      }),
    );
  }, [current, isImage, isAudio, mediaBase, navigate, queue.queue]);

  // The second to come back to, offered only to the file the player left from.
  // The detail view hands back where *it* got to, which is ahead of the detour
  // whenever the user kept watching there; the parked second is the fallback
  // for an item with no player of its own (a picture).
  //
  // Dropped as soon as the pass steps somewhere else (goNext / goPrev below), so
  // coming back to that file later in the same pass — or on the next lap with
  // repeat on — starts it where any other item would.
  const handedBack = searchParams.get("t");
  const resumeSec =
    current && pickUp?.key === queueKey(current)
      ? handedBack != null && Number.isFinite(Number(handedBack))
        ? Math.max(0, Math.floor(Number(handedBack)))
        : pickUp.sec
      : 0;
  // Back from the detail view on the very item the pass was parked on: the
  // bar's track is left in whatever state the user put it there.
  const isDetourPickUp = !!current && pickUp?.key === queueKey(current);

  // Without its details there is nothing to render for this item, so a failed
  // fetch would leave the stage blank for good. Treat it like any other
  // unplayable item and move on (FR-015).
  useEffect(() => {
    if (!current || !detail.isError) return;
    skipCurrent();
  }, [current, detail.isError, skipCurrent]);

  // Images have no "play" event of their own, so viewing one is the play record
  // (mirrors the detail view, and is what removes it from Watch Later).
  useRecordImageView({
    wsId: current?.workspaceId ?? "",
    fileId: current?.fileId,
    kind: current?.kind,
    onRecorded: () => invalidatePlayedSearches(qc),
  });

  const { chromeVisible, wake } = useChromeIdle();
  // Any volume change gets an answer on screen. The keys are handled in two
  // places (here for images, the video player for everything else) and the
  // detail view can move the same value, so watching the value itself covers
  // every route without wiring a callback through each one.
  useWakeOnChange(wake, `${volume}:${muted}`);

  // Decode the next item ahead of time so the swap lands on a warm cache. Only
  // its pixels: file_get records an access server-side, so prefetching the
  // detail would mark items as seen before the user ever reaches them.
  const upcoming = queue.upcoming;
  useEffect(() => {
    if (!upcoming || !mediaBase) return;
    // Audio may have no thumbnail at all (no embedded cover art), and the queue
    // item cannot tell; a guaranteed 404 is not worth warming.
    if (upcoming.kind === "audio") return;
    const kind = upcoming.kind === "image" ? "media" : "thumb";
    const img = new Image();
    img.src = `${mediaBase}/ws/${upcoming.workspaceId}/${kind}/${upcoming.fileId}`;
  }, [upcoming, mediaBase]);

  const wsId = current?.workspaceId ?? "";
  // Both URLs are addressable from the queue item alone. Deriving them from the
  // fetched detail instead put an IPC round trip between the swap and the first
  // pixel, which is the gap that showed up on every next/previous. The detail
  // now only enriches what is already on screen (the file's name).
  const thumbSrc = current
    ? (thumbUrl(mediaBase, wsId, current.fileId) ?? undefined)
    : undefined;
  const mediaSrc =
    mediaBase && current
      ? `${mediaBase}/ws/${wsId}/media/${current.fileId}`
      : "";

  const { leaving, transitionTo } = useStageTransition({
    rootRef,
    videoRef,
    transitionMs,
    stageKey: currentKey,
    thumbSrc,
  });
  const goNext = useCallback(
    () =>
      transitionTo(() => {
        setPaused(false);
        setPickUp(null);
        next();
      }, 1),
    [next, transitionTo],
  );
  const goPrev = useCallback(
    () =>
      transitionTo(() => {
        setPaused(false);
        setPickUp(null);
        prev();
      }, -1),
    [prev, transitionTo],
  );

  const { audioPlaying, toggleAudio } = usePlaylistAudio({
    current,
    file,
    mediaBase,
    isDetourPickUp,
    resumeSec,
    goNext,
    skipCurrent,
  });
  // The bar draws no chrome here, so a play/pause has to wake the control bar
  // to be seen at all (the video reports the same through onPlayingChange).
  useWakeOnChange(wake, audioPlaying, isAudio);

  const togglePlay = useCallback(() => {
    if (isImage) {
      setPaused((p) => !p);
      return;
    }
    if (isAudio) {
      toggleAudio();
      return;
    }
    videoRef.current?.togglePlay();
  }, [isImage, isAudio, toggleAudio]);

  const toggleShuffle = useCallback(
    () => setPlaylistShuffle(!playlistShuffle),
    [playlistShuffle, setPlaylistShuffle],
  );
  const toggleRepeat = useCallback(
    () => setPlaylistRepeat(!playlistRepeat),
    [playlistRepeat, setPlaylistRepeat],
  );

  usePlayerKeys({
    isImage,
    isAudio,
    togglePlay,
    openDetail,
    goNext,
    goPrev,
    toggleShuffle,
    toggleFullscreen,
    exit,
    navBinding,
    wake,
  });

  // Nothing playable: say so rather than sitting on a black screen (FR-016).
  const empty = queue.ended && queue.total === 0;
  useEffect(() => {
    if (!queue.ended || queue.total === 0) return;
    // A pass where nothing could be played ends on the explanation below rather
    // than dropping the user back on the list with no idea why (FR-015).
    if (queue.unplayable) return;
    // Finished a pass with repeat off — hand the user back to their list (FR-006).
    exit();
  }, [queue.ended, queue.total, queue.unplayable, exit]);

  const title = file ? fileNameOf(file.relPath) : "";
  // Whether an audio item has cover art on screen (the spectrum lays itself
  // out around it, or takes its place).
  const hasArt = Boolean(file && hasThumbFile(file) && thumbSrc);
  const imageMotion = playlistImageMotion && !reducedMotion;
  const playing = isImage ? !paused : isAudio ? audioPlaying : videoPlaying;

  const emptyMessage = queue.unplayable
    ? t("playlist.unplayable")
    : t("playlist.empty");

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("playlist.start")}
      className={cn("fixed inset-0 z-50 overflow-hidden", ground)}
      onMouseMove={wake}
      // Pressing a control counts as activity in its own right. Without this the
      // bar keeps counting down from the last mouse *movement*, so clicking Next
      // and holding still makes it vanish a moment later — right as the user is
      // reaching for it again. Pointer-down rather than click so that starting a
      // drag on the volume slider counts too; keyboard activation already
      // arrives here as a bubbling keydown.
      onPointerDown={wake}
      onKeyDown={wake}
    >
      {queue.waiting && !current ? (
        <div className="flex h-full w-full items-center justify-center text-muted">
          <p>{t("playlist.loading")}</p>
        </div>
      ) : empty || queue.unplayable ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center text-muted">
          <p>{emptyMessage}</p>
          <p className="text-sm">{t("playlist.emptyHint")}</p>
        </div>
      ) : (
        <>
          {leaving && (
            <div
              key={leaving.snapshot.key}
              data-slot="player-leaving"
              className="absolute inset-0"
              style={leavingStyle(
                leaving.leg,
                leaving.dir,
                transitionMs,
                playlistFade,
                playlistTransition,
              )}
            >
              <SnapshotStage snapshot={leaving.snapshot} ground={ground} />
            </div>
          )}
          <div
            data-slot="player-fade"
            className="absolute inset-0"
            style={enteringStyle(
              leaving?.leg ?? null,
              leaving?.dir ?? 1,
              transitionMs,
              playlistFade,
              playlistTransition,
            )}
          >
            <PlayerStage backdropSrc={thumbSrc} ground={ground}>
              {current && isImage && (
                <ImageStage
                  src={mediaSrc}
                  alt={file?.relPath ?? ""}
                  durationMs={playlistImageSeconds * 1000}
                  paused={paused}
                  motion={imageMotion}
                  onDone={goNext}
                  onError={skipCurrent}
                />
              )}
              {current && !isImage && !isAudio && (
                <VideoPlayer
                  ref={videoRef}
                  key={`${wsId}:${current.fileId}`}
                  id={current.fileId}
                  src={mediaSrc}
                  // Chromeless hides the seek bar and drops the aspect-ratio box,
                  // so these only enrich; the video need not wait for them.
                  duration={file?.duration ?? null}
                  width={file?.width ?? null}
                  height={file?.height ?? null}
                  mediaBase={mediaBase}
                  wsId={wsId}
                  startAt={resumeSec}
                  autoplay
                  navKeys={navBinding}
                  fullscreenTargetRef={rootRef}
                  onNativeDuration={() => undefined}
                  onPlayed={() => invalidatePlayedSearches(qc)}
                  // Reclaims the sound on every start (first play, resume,
                  // item switch), not only when the player mounted.
                  onPlaybackStart={claimPlayback}
                  chromeless
                  onEnded={goNext}
                  onPlayingChange={(playing) => {
                    setVideoPlaying(playing);
                    // The video draws no chrome of its own here, so a play/pause
                    // from the keyboard would otherwise change nothing on screen.
                    wake();
                  }}
                  onFatalError={skipCurrent}
                  t={t}
                />
              )}
              {current && isAudio && (
                <AudioArt
                  thumbSrc={thumbSrc}
                  hasArt={hasArt}
                  playing={audioPlaying}
                />
              )}
            </PlayerStage>
          </div>
        </>
      )}

      {!empty && !queue.unplayable && (
        <PlayerChrome
          title={title}
          position={queue.position}
          total={queue.total}
          playing={playing}
          shuffle={playlistShuffle}
          repeat={playlistRepeat}
          fullscreen={isFullscreen}
          canPrev={queue.canPrev}
          visible={chromeVisible}
          volume={volume}
          muted={muted}
          audible={!isImage}
          canOpenDetail={!!current}
          onOpenDetail={openDetail}
          onVolumeChange={setVolume}
          onToggleMute={toggleMuted}
          onTogglePlay={togglePlay}
          onPrev={goPrev}
          onNext={goNext}
          onToggleShuffle={toggleShuffle}
          onToggleRepeat={toggleRepeat}
          spectrum={
            isAudio ? (reducedMotion ? null : audioSpectrum) : undefined
          }
          onToggleSpectrum={() => setAudioSpectrum(!audioSpectrum)}
          onToggleFullscreen={toggleFullscreen}
          onExit={exit}
          t={t}
        />
      )}
    </div>
  );
}
