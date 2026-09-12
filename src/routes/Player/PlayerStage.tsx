import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Full-bleed stage for one playlist item. The layering follows the discovery
// view — a blurred cover fills the frame and the sharp media sits on top at its
// own aspect ratio — but nothing here is transparent to what is behind the
// player, and there is no panel frame, padding or rounding (spec FR-021).
//
// The ground follows the appearance: black in dark mode, white in light. An
// image with transparency is composited straight onto it, so a fixed black would
// swallow light artwork for anyone working in a light theme.
export function PlayerStage({
  backdropSrc,
  ground,
  children,
}: {
  /**
   * Thumbnail used as the blurred backdrop. Requested without first checking
   * that one has been generated — waiting on that answer would stall the switch
   * — so a miss just leaves the ground showing.
   */
  backdropSrc?: string;
  /** Tailwind background class for the ground, decided by the appearance. */
  ground: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("absolute inset-0 overflow-hidden", ground)}>
      {backdropSrc && (
        <img
          key={backdropSrc}
          src={backdropSrc}
          alt=""
          aria-hidden
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
        />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
      {/* Scrim so the chrome stays legible over bright media. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[32%] bg-gradient-to-t from-bg/90 via-bg/40 to-transparent" />
    </div>
  );
}
