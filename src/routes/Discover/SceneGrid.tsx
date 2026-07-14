import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePreferences } from "@/settings/PreferencesProvider";
import { formatDuration } from "@/lib/format";
import { detailPath } from "./utils";

// Responsive grid of evenly-spaced scene frames that fills the available height.
// Each tile links to the detail/player at that timestamp.
export function SceneGrid({
  id,
  total,
  mediaBase,
  wsId,
  filterParam,
  className,
}: {
  id: number;
  total: number;
  mediaBase: string;
  wsId: string;
  filterParam?: string;
  className?: string;
}) {
  const { sceneCount } = usePreferences();
  const scenes = Array.from({ length: sceneCount }, (_, i) =>
    Math.floor((total * (i + 0.5)) / sceneCount),
  );
  return (
    <ScrollArea className={cn("min-h-0", className)} viewportClassName="pr-3">
      <div
        className={cn(
          "grid content-start gap-1.5",
          "grid-cols-[repeat(auto-fill,minmax(150px,1fr))]",
        )}
      >
        {scenes.map((sec, i) => (
          <Link
            key={i}
            to={detailPath(id, wsId, filterParam, sec)}
            className="group/scene relative block aspect-video overflow-hidden rounded-md border border-border transition hover:border-primary"
          >
            <img
              src={`${mediaBase}/ws/${wsId}/frame/${id}?t=${sec}`}
              alt=""
              loading="lazy"
              className="h-full w-full bg-black object-cover transition group-hover/scene:opacity-85"
            />
            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[10px] tabular-nums text-white">
              {formatDuration(sec, { hours: true, fallback: "—" })}
            </span>
          </Link>
        ))}
      </div>
    </ScrollArea>
  );
}
