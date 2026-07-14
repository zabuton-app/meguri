import { Loader2, Star } from "lucide-react";
import type { TFunc } from "@/i18n/I18nProvider";

// Star toggle shared by SceneThumb and BookmarkThumb. Active when this scene is the source
// of the file's main thumbnail; clicking toggles between "set as main" and "revert to auto".
// While saving, only this specific star is busy — the other stars on screen stay enabled
// so the page doesn't feel frozen during the ffmpeg roundtrip.
export function MainThumbStar({
  isMainThumb,
  pending,
  onClick,
  t,
  alwaysVisible,
}: {
  isMainThumb: boolean;
  pending: boolean;
  onClick: () => void;
  t: TFunc;
  alwaysVisible: boolean;
}) {
  const label = pending
    ? t("media.thumbApplying")
    : isMainThumb
      ? t("media.thumbClear")
      : t("media.thumbSet");
  // Active state: fill the button with the primary color so the icon reads strongly on top
  // of bg-black/70 (some themes use yellow/orange/red primaries whose outline-only stars
  // blended into the dark background). Inactive stays on the neutral dark chip.
  const chip = isMainThumb
    ? "bg-[var(--c-primary)] text-primary-foreground ring-1 ring-[var(--c-primary)]/60 ring-offset-1 ring-offset-black/40"
    : "bg-black/70 text-white hover:bg-black/85";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={pending}
      aria-busy={pending}
      title={label}
      aria-label={label}
      aria-pressed={isMainThumb}
      // Hidden by default; shown on parent hover, on keyboard focus, or always when active
      // (so users know which scene is the current source without having to hover-probe).
      // While pending, stay visible AND keep the cursor default — the spinner on the icon
      // already signals "working"; an OS-level wait cursor on top of that looks frozen.
      className={`absolute left-1 top-1 h-6 w-6 items-center justify-center rounded-full transition focus-visible:flex ${chip} ${
        alwaysVisible || pending
          ? "flex"
          : "hidden group-hover/scene:flex group-hover/bm:flex"
      }`}
    >
      {pending ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Star size={14} className={isMainThumb ? "fill-current" : ""} />
      )}
    </button>
  );
}
