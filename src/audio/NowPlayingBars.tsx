// A "now playing" glyph: three little bars bobbing while the bar's track
// sounds, so the player bar shows at a glance that something is playing. Not
// a spectrum — it follows nothing but the play state; a CSS animation on the
// compositor is all it costs. Still while paused, and absent under the OS
// reduce-motion setting (the host shows its static glyph instead).
import { cn } from "@/lib/utils";

interface Props {
  /** Whether the track is sounding: bobbing when true, still when false. */
  playing: boolean;
  className?: string;
}

export function NowPlayingBars({ playing, className }: Props) {
  return (
    <span
      data-testid="now-playing"
      data-playing={playing}
      aria-hidden
      className={cn(
        "fx-eq flex h-4 w-4 items-end justify-center gap-[2px]",
        !playing && "fx-eq-still",
        className,
      )}
    >
      <span className="fx-eq-bar h-full w-[3px] rounded-[1px] bg-current" />
      <span className="fx-eq-bar h-full w-[3px] rounded-[1px] bg-current" />
      <span className="fx-eq-bar h-full w-[3px] rounded-[1px] bg-current" />
    </span>
  );
}
