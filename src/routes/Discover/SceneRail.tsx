import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/settings/PreferencesProvider";
import { formatDuration } from "@/lib/format";
import type { TFunc } from "@/i18n/I18nProvider";
import { detailPath } from "./utils";

// Base tile width + flex gap; used to compute how many tiles fit the rail.
const TILE_W = 104;
const TILE_GAP = 6;

// Single horizontal row of evenly-spaced scene frames overlaid on the immersive
// card. Only as many tiles as fit the measured width are rendered; the rest is
// summarized as "+N". Each tile links to the detail/player at that timestamp.
export function SceneRail({
  id,
  total,
  mediaBase,
  wsId,
  filterParam,
  t,
  className,
}: {
  id: number;
  total: number;
  mediaBase: string;
  wsId: string;
  filterParam?: string;
  t: TFunc;
  className?: string;
}) {
  const { sceneCount } = usePreferences();
  const [railEl, setRailEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!railEl) return;
    const compute = () => setWidth(railEl.clientWidth);
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(railEl);
    return () => ro.disconnect();
  }, [railEl]);

  const scenes = Array.from({ length: sceneCount }, (_, i) =>
    Math.floor((total * (i + 0.5)) / sceneCount),
  );
  // Leave room for the trailing "+N" label so it never wraps or clips.
  const fit = Math.max(1, Math.floor((width - 40) / (TILE_W + TILE_GAP)));
  const visible = scenes.slice(0, Math.min(fit, sceneCount));
  const hidden = scenes.length - visible.length;

  return (
    <div className={cn("min-w-0", className)}>
      <div
        ref={setRailEl}
        className="flex items-end gap-1.5 overflow-hidden pt-2"
      >
        {visible.map((sec, i) => (
          <Link
            key={i}
            to={detailPath(id, wsId, filterParam, sec)}
            className="group/scene relative block w-[104px] shrink-0 overflow-hidden rounded-md border border-border/60 bg-black shadow-md transition-all duration-150 hover:z-10 hover:w-[132px] hover:-translate-y-1 hover:border-primary hover:shadow-lg"
          >
            <img
              src={`${mediaBase}/ws/${wsId}/frame/${id}?t=${sec}`}
              alt=""
              loading="lazy"
              className="aspect-[16/10] w-full object-cover"
            />
            <span className="absolute bottom-0.5 right-0.5 rounded bg-bg/80 px-1 text-[10px] tabular-nums text-fg">
              {formatDuration(sec, { hours: true, fallback: "—" })}
            </span>
          </Link>
        ))}
        {hidden > 0 && (
          <span className="shrink-0 pb-1 text-[11px] tabular-nums text-muted">
            {t("discover.moreScenes", { count: hidden })}
          </span>
        )}
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-muted">
        {t("discover.sceneHint")}
      </p>
    </div>
  );
}
