// Persistent bottom player bar for audio playback.
//
// Participates in layout between the routed content and the status bar rather than
// floating over it, so it never occludes the last row of the list, and occupies zero
// height when no track is loaded. Only the seek bar and the time readout consume useAudioPosition(), so the
// per-tick re-render stays confined to those two small components.
import { useEffect, useLayoutEffect, useState } from "react";
import { Music, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppStatus } from "@/hooks/useAppStatus";
import { events } from "@/ipc/client";
import { fileHref } from "@/lib/fileHref";
import { navigateOutsideRouter } from "@/lib/routerBridge";
import { hasThumbFile, thumbUrl } from "@/lib/thumbUrl";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { NowPlayingBars } from "./NowPlayingBars";
import type { AudioTrack } from "./context";
import { useAudioPlayer } from "./useAudioPlayer";
import { AudioTransport, CTRL_CLASS } from "./AudioTransport";
import { useBarSuppressed } from "./barVisibility";

function baseName(relPath: string): string {
  const parts = relPath.split(/[\\/]/);
  return parts[parts.length - 1] || relPath;
}

function outsideRouterOrigin(): string {
  const state = window.history.state as
    { usr?: { outsideRouter?: boolean; origin?: string } } | undefined;
  const carried = state?.usr;
  if (carried?.outsideRouter && carried.origin) return carried.origin;
  const hashPath = window.location.hash.slice(1) || "/";
  return hashPath.startsWith("/") ? hashPath : `/${hashPath}`;
}

/** Whether the loaded track has cover art, and the cache-busting version of it.
 *
 *  The row the track was started from is a snapshot: a track played while the
 *  scan is still extracting covers has `hasThumb: 0` at that moment, and a cover
 *  regenerated later sits behind the same URL. `thumb:done` for this file says
 *  a cover now exists, so it flips availability and busts the cache.
 *
 *  Lives in the bar component (which stays mounted, rendering nothing, while
 *  the detail view suppresses it) rather than in the cover element, so an
 *  event delivered while the bar is hidden is not missed. State is keyed by
 *  track: a value recorded for another track reads as the fresh snapshot. */
function useTrackCover(track: AudioTrack | null): {
  hasCover: boolean;
  version: number | undefined;
} {
  const key = track ? `${track.workspaceId}:${track.file.id}` : "";
  const snapshotHasCover = track ? hasThumbFile(track.file) : false;
  const [seen, setSeen] = useState<{
    key: string;
    hasCover: boolean;
    version: number | undefined;
  } | null>(null);
  const fileId = track?.file.id;
  const workspaceId = track?.workspaceId;
  useEffect(() => {
    if (!key) return;
    // The unlisten arrives a microtask after the subscription is live, and the
    // track can change in the very same commit — so a cleanup that runs before
    // then must still take the subscription down, or it leaks one listener.
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void events
      .onThumbDone((event) => {
        if (event.id !== fileId) return;
        if (event.workspaceId && event.workspaceId !== workspaceId) return;
        setSeen((prev) => {
          const version = prev?.key === key ? (prev.version ?? 0) + 1 : 1;
          return { key, hasCover: true, version };
        });
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [key, fileId, workspaceId]);
  if (seen && seen.key === key)
    return { hasCover: seen.hasCover, version: seen.version };
  return { hasCover: snapshotHasCover, version: undefined };
}

// Published so bottom-anchored overlays (the FABs, the scan-progress panel) can
// lift themselves clear of the bar: the distance from the viewport's bottom edge
// to the bar's top edge, which also covers whatever sits below the bar (the
// status bar). It stays 0px whenever the bar is not showing, so those overlays
// keep their original position in that case.
const BAR_INSET_VAR = "--meguri-player-bar-inset";

/** Mirrors the bar's measured bottom inset into a CSS variable on <html>.
 *
 *  Assumes a single mounted bar (App.tsx mounts exactly one). With two, the
 *  first to unmount would reset the variable while the other is still showing.
 *  Runs as a layout effect so the offset is in place before the browser paints
 *  the frame the bar appears in — otherwise the FAB overlaps it for one frame. */
function usePublishBarInset(el: HTMLDivElement | null): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!el) {
      root.style.setProperty(BAR_INSET_VAR, "0px");
      return;
    }
    let last = "";
    const publish = () => {
      const inset = Math.max(
        0,
        root.clientHeight - el.getBoundingClientRect().top,
      );
      const next = `${inset}px`;
      // ResizeObserver also fires for width changes (every frame of a window
      // resize), and rewriting a :root custom property invalidates the whole
      // document's styles, so only touch it when the value moved.
      if (next === last) return;
      last = next;
      root.style.setProperty(BAR_INSET_VAR, next);
    };
    publish();
    // The bar's height changes with the content zoom and with the error row
    // replacing the seek control, so measure rather than hardcode.
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    window.addEventListener("resize", publish);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", publish);
      root.style.setProperty(BAR_INSET_VAR, "0px");
    };
  }, [el]);
}

export function AudioPlayerBar() {
  const { current, close, isPlaying } = useAudioPlayer();
  const { t } = useI18n();
  const suppressed = useBarSuppressed();
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
  const cover = useTrackCover(current);
  usePublishBarInset(barEl);

  // Occupies no space at all when nothing is loaded, or while the detail view
  // is open (see barVisibility.ts; for audio it shows the same controls under
  // the cover art).
  // Unmounting also resets the published inset, so the overlays that lift
  // themselves clear of the bar drop back down.
  if (!current || suppressed) return null;

  const name = baseName(current.file.relPath);

  return (
    <div
      ref={setBarEl}
      role="region"
      aria-label={t("player.audio.region")}
      // Part of the shell, not an overlay: the route modals (settings, history,
      // tags, duplicates, discovery) dim it along with the rest of the window
      // rather than leaving it lit on top of them, playback carries on
      // underneath, and the detail view hides it altogether. The playlist
      // player covers it after pausing it.
      className="flex shrink-0 items-center gap-3 border-t border-border bg-bg px-3 py-2 text-sm text-fg"
    >
      {/* Keyed on the track so a failed cover doesn't stick: remounting resets
          the fallback state, and the previous jacket never shows while the new
          one loads. */}
      <Cover
        key={`${current.workspaceId}:${current.file.id}`}
        track={current}
        hasCover={cover.hasCover}
        version={cover.version}
        playing={isPlaying}
      />
      {/* Announced when the track changes; position updates are never announced.
          The name is the way back to the track's detail view (tags, rating).
          The bar sits outside RouterProvider, so it goes through the router
          bridge; `autoplay: false` so opening the details never restarts or
          resumes what the bar is doing. */}
      <button
        type="button"
        onClick={() => {
          navigateOutsideRouter(
            fileHref(current.file.id, current.workspaceId, {
              autoplay: false,
            }),
            {
              state: {
                outsideRouter: true,
                origin: outsideRouterOrigin(),
              },
            },
          );
        }}
        className="min-w-0 max-w-64 flex-1 truncate text-left transition hover:text-bright-fg hover:underline"
        title={t("player.audio.openDetail")}
        aria-label={`${t("player.audio.openDetail")}: ${name}`}
        aria-live="polite"
      >
        {name}
      </button>

      <AudioTransport
        target={{ fileId: current.file.id, workspaceId: current.workspaceId }}
      />

      <button
        type="button"
        onClick={close}
        title={t("player.audio.close")}
        aria-label={t("player.audio.close")}
        className={CTRL_CLASS}
      >
        <X size={18} />
      </button>
    </div>
  );
}

/** The track's embedded cover art, falling back to a music note when the file has
 *  none (or the image fails to load). Square and bar-height, so a taller jacket
 *  cannot grow the bar and shift every bottom-anchored overlay with it.
 *
 *  Decorative: the filename beside it already identifies the track, so an alt text
 *  here would only make screen readers announce the same name twice. */
function Cover({
  track,
  hasCover,
  version,
  playing,
}: {
  track: AudioTrack;
  hasCover: boolean;
  version: number | undefined;
  playing: boolean;
}) {
  const status = useAppStatus();
  const mediaBase = status.data?.mediaBase ?? "";
  // While the track sounds the bobbing glyph sits over the tile in a dark
  // well — the same tile whether it holds the jacket or the placeholder, so
  // nothing shifts between tracks with and without art. Not under reduce
  // motion: the plain tile then.
  const reducedMotion = usePrefersReducedMotion();
  const bob = playing && !reducedMotion;
  // The URL that failed rather than a flag, so a regenerated cover (a new
  // version, hence a new URL) gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = hasCover
    ? thumbUrl(mediaBase, track.workspaceId, track.file.id, version)
    : null;

  const showArt = src != null && failedSrc !== src;
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-overlay text-muted">
      {showArt ? (
        <img
          src={src}
          alt=""
          onError={() => setFailedSrc(src)}
          className="size-full object-cover"
        />
      ) : (
        // No art: a grey placeholder tile of the same size, with the kind's
        // glyph in it.
        <Music size={16} aria-hidden="true" />
      )}
      {bob && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
          <NowPlayingBars playing />
        </span>
      )}
    </span>
  );
}
