// Persistent bottom player bar for audio playback.
//
// Participates in layout between the routed content and the status bar rather than
// floating over it, so it never occludes the last row of the list, and occupies zero
// height when no track is loaded. Only the seek bar and the time readout consume useAudioPosition(), so the
// per-tick re-render stays confined to those two small components.
import { useLayoutEffect, useState } from "react";
import { Music, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppStatus } from "@/hooks/useAppStatus";
import { fileHref } from "@/lib/fileHref";
import type { AudioTrack } from "./context";
import { useAudioPlayer } from "./useAudioPlayer";
import { AudioTransport, CTRL_CLASS } from "./AudioTransport";
import { useBarSuppressed } from "./barVisibility";

function baseName(relPath: string): string {
  const parts = relPath.split(/[\\/]/);
  return parts[parts.length - 1] || relPath;
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
  const {
    current,
    isPlaying,
    duration,
    volume,
    muted,
    error,
    toggle,
    seek,
    setVolume,
    toggleMuted,
    close,
    dismissError,
  } = useAudioPlayer();
  const { t } = useI18n();
  const suppressed = useBarSuppressed();
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
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
      />
      {/* Announced when the track changes; position updates are never announced.
          The name is the way back to the track's detail view (tags, rating).
          The bar sits outside RouterProvider, so it navigates through the hash
          the router listens to; `autoplay: false` so opening the details never
          restarts or resumes what the bar is doing. */}
      <button
        type="button"
        onClick={() => {
          window.location.hash = fileHref(
            current.file.id,
            current.workspaceId,
            {
              autoplay: false,
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
        live
        isPlaying={isPlaying}
        onTogglePlay={toggle}
        duration={duration}
        onSeek={seek}
        volume={volume}
        muted={muted}
        onVolume={setVolume}
        onToggleMuted={toggleMuted}
        error={error}
        onDismissError={dismissError}
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
function Cover({ track }: { track: AudioTrack }) {
  const status = useAppStatus();
  const mediaBase = status.data?.mediaBase ?? "";
  const [failed, setFailed] = useState(false);
  const src =
    track.file.hasThumb === 1 && mediaBase
      ? `${mediaBase}/ws/${track.workspaceId}/thumb/${track.file.id}`
      : null;

  if (!src || failed) {
    return (
      <Music size={18} className="shrink-0 text-muted" aria-hidden="true" />
    );
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="size-8 shrink-0 rounded-sm object-cover"
    />
  );
}
