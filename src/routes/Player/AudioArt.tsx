import { Music } from "lucide-react";
import { AudioSpectrum } from "@/audio/AudioSpectrum";
import { PATTERN_LAYOUT } from "@/audio/spectrumPatterns";
import { useSpectrumPattern } from "@/audio/useSpectrumPattern";
import { cn } from "@/lib/utils";

/**
 * What the stage shows for an audio item. The sound comes from the bar's
 * element, so this is the cover art (or the kind's glyph) where the picture
 * would be, with the spectrum laid out around it — or in its place.
 */
export function AudioArt({
  thumbSrc,
  hasArt,
  playing,
}: {
  thumbSrc: string | undefined;
  /** Whether cover art is on screen (the spectrum lays itself out around it). */
  hasArt: boolean;
  playing: boolean;
}) {
  const spectrumPattern = useSpectrumPattern();
  const spectrumLayout = spectrumPattern
    ? PATTERN_LAYOUT[spectrumPattern]
    : null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {hasArt ? (
        <img
          src={thumbSrc}
          alt=""
          className="max-h-[70%] max-w-[70%] rounded-lg object-contain shadow-2xl"
        />
      ) : (
        <Music
          className={cn(
            "text-muted",
            !spectrumLayout && "size-32",
            spectrumLayout?.glyph === "center" && "size-16",
            spectrumLayout?.glyph === "corner" &&
              "absolute left-5 top-5 size-8",
          )}
          aria-hidden
        />
      )}
      {spectrumLayout && (
        <AudioSpectrum
          active={playing}
          mode={hasArt ? "overlay" : "full"}
          className={hasArt ? spectrumLayout.overlayBox : "absolute inset-0"}
        />
      )}
    </div>
  );
}
