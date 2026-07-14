import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { usePreferences } from "@/settings/PreferencesProvider";
import type { TFunc } from "@/i18n/I18nProvider";
import { MainThumbStar } from "./MainThumbStar";
import { fmtTime, isSameThumbSource, isThumbPendingFor } from "./utils";

export function Scenes({
  id,
  total,
  mediaBase,
  wsId,
  thumbOffsetSec,
  pendingThumbSec,
  mainThumbUrl,
  mainThumbPending,
  onSeek,
  onSetMainThumb,
  t,
}: {
  id: number;
  total: number;
  mediaBase: string;
  wsId: string;
  thumbOffsetSec: number | null;
  /** sec being applied (or null if a revert-to-auto is in flight); undefined when idle. */
  pendingThumbSec: number | null | undefined;
  /** Cache-busted URL of the file's current main thumbnail (null until generated). */
  mainThumbUrl: string | null;
  /** True while a regeneration is in flight; overlays a spinner on the preview. */
  mainThumbPending: boolean;
  onSeek: (t: number) => void;
  onSetMainThumb: (sec: number | null) => void;
  t: TFunc;
}) {
  // Representative scene times at even intervals (the center of each segment).
  // The count is user-configurable in settings (default 12).
  const { sceneCount } = usePreferences();
  const scenes = Array.from({ length: sceneCount }, (_, i) =>
    Math.floor((total * (i + 0.5)) / sceneCount),
  );
  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h3 className="text-xs font-semibold uppercase text-muted">
          {t("media.scenes")}
        </h3>
        {/* Live preview of the file's main thumbnail so the user sees the change land,
            instead of having to navigate back to the list to confirm. */}
        {mainThumbUrl && (
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span>{t("media.currentMainThumb")}</span>
            <div
              className="relative h-10 overflow-hidden rounded border border-border bg-black"
              aria-busy={mainThumbPending}
            >
              <img src={mainThumbUrl} alt="" className="h-full w-auto" />
              {mainThumbPending && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                  <Loader2 size={14} className="animate-spin text-white" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <ScrollArea className="w-full" viewportClassName="pb-3">
        <div className="flex gap-2">
          {scenes.map((sec, i) => {
            const isMain = isSameThumbSource(thumbOffsetSec, sec);
            const pending = isThumbPendingFor(pendingThumbSec, sec, isMain);
            return (
              <SceneThumb
                key={i}
                id={id}
                sec={sec}
                mediaBase={mediaBase}
                wsId={wsId}
                isMainThumb={isMain}
                thumbPending={pending}
                onSeek={onSeek}
                onSetMainThumb={onSetMainThumb}
                t={t}
              />
            );
          })}
        </div>
      </ScrollArea>
    </section>
  );
}

// A single scene thumbnail. Shows a skeleton until the frame image loads,
// since frames are fetched lazily (ffmpeg renders them on demand).
function SceneThumb({
  id,
  sec,
  mediaBase,
  wsId,
  isMainThumb,
  thumbPending,
  onSeek,
  onSetMainThumb,
  t,
}: {
  id: number;
  sec: number;
  mediaBase: string;
  wsId: string;
  isMainThumb: boolean;
  thumbPending: boolean;
  onSeek: (t: number) => void;
  onSetMainThumb: (sec: number | null) => void;
  t: TFunc;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="group/scene relative shrink-0">
      <button
        type="button"
        onClick={() => onSeek(sec)}
        className={`relative block overflow-hidden rounded-lg border transition hover:border-[var(--c-primary)] ${
          isMainThumb ? "border-[var(--c-primary)]" : "border-border"
        }`}
        title={t("scene.seekTo", { time: fmtTime(sec) })}
      >
        {/* Reserve a 16:9-ish box so the skeleton has size before the frame's intrinsic width is known. */}
        {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
        <img
          src={`${mediaBase}/ws/${wsId}/frame/${id}?t=${sec}`}
          alt={t("scene.alt", { time: fmtTime(sec) })}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`h-24 bg-black transition group-hover/scene:opacity-85 ${
            loaded ? "w-auto opacity-100" : "w-40 opacity-0"
          }`}
        />
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] tabular-nums text-white">
          {fmtTime(sec)}
        </span>
      </button>
      <MainThumbStar
        isMainThumb={isMainThumb}
        pending={thumbPending}
        onClick={() => onSetMainThumb(isMainThumb ? null : sec)}
        t={t}
        // Stay visible while it's the active main thumb; otherwise fade in on hover/focus.
        alwaysVisible={isMainThumb}
      />
    </div>
  );
}
