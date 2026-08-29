import type { ReactNode } from "react";

// Full-bleed stage for one playlist item. The layering follows the discovery
// view — a blurred cover fills the frame and the sharp media sits on top at its
// own aspect ratio — but nothing here is transparent to what is behind the
// player, and there is no panel frame, padding or rounding (spec FR-021).
export function PlayerStage({
  backdropSrc,
  children,
}: {
  /** Thumbnail used as the blurred backdrop; omitted while none exists yet. */
  backdropSrc?: string;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {backdropSrc && (
        <img
          src={backdropSrc}
          alt=""
          aria-hidden
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
