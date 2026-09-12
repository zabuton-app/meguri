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
      // z-[60] lifts the bar above the route modals that leave it showing
      // (z-50: settings, history, dialogs) so playback stays reachable while
      // one is open. The playlist player (z-[70]) and the shortcuts overlay
      // (z-[80]) still cover it on purpose; the detail view hides it instead.
      className="relative z-[60] flex shrink-0 items-center gap-3 border-t border-border bg-bg px-3 py-2 text-sm text-fg"
    >
      {/* Keyed on the track so a failed cover doesn't stick: remounting resets
          the fallback state, and the previous jacket never shows while the new
          one loads. */}
      <Cover
        key={`${current.workspaceId}:${current.file.id}`}
        track={current}
      />
      {/* Announced when the track changes; position updates are never announced. */}
      <span
        className="min-w-0 max-w-64 flex-1 truncate"
        title={name}
        aria-live="polite"
      >
        {name}
      </span>

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
