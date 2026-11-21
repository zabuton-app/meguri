import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Power, SlidersHorizontal, X } from "lucide-react";
import type { TFunc } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import log from "@/lib/logger";
import {
  gradeChangesPicture,
  gradeControls,
  gradeKeys,
  neutralGrade,
  toneCurvePivotInput,
  videoToneCurve,
  type GradeControl,
  type VideoGrade,
} from "./colorGrade";
import { createGradeRenderer } from "./colorGradeRenderer";

/** The detail view's side panel the controls render into, and whether it is
 *  open. The view owns both, so the panel stays open across files while each
 *  file's grade starts neutral (this component is keyed by file). */
export interface VideoAdjustmentsPanel {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the panel renders once mounted; null while closed. A bare slot:
   *  the panel draws its own frame, so a player that is not showing these
   *  controls (its error screen) leaves nothing on screen. */
  container: HTMLElement | null;
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  playing: boolean;
  loaded: boolean;
  panel: VideoAdjustmentsPanel;
  t: TFunc;
}

export function VideoGradeOverlay({
  videoRef,
  playing,
  loaded,
  panel,
  t,
}: Props) {
  const { open, onOpenChange, container } = panel;
  const [grade, setGrade] = useState(neutralGrade);
  const [enabled, setEnabled] = useState(true);
  const [held, setHeld] = useState<GradeControl | null>(null);
  const [failed, setFailed] = useState(false);
  const [previewStarted, setPreviewStarted] = useState(false);
  const hintId = useId();
  const colorId = useId();
  const previewGrade = held ? { ...grade, [held]: neutralGrade[held] } : grade;
  const active =
    enabled && !failed && loaded && gradeChangesPicture(previewGrade);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const release = () => setHeld(null);
    window.addEventListener("blur", release);
    return () => window.removeEventListener("blur", release);
  }, []);

  function close() {
    setHeld(null);
    onOpenChange(false);
    trigger.current?.focus();
  }

  function update(value: VideoGrade) {
    setGrade(value);
    if (gradeChangesPicture(value)) setPreviewStarted(true);
  }

  return (
    <>
      {previewStarted && !failed && loaded && (
        <GradedFrame
          videoRef={videoRef}
          grade={previewGrade}
          active={active}
          onError={setFailed}
        />
      )}
      {(loaded || open) && (
        <button
          ref={trigger}
          type="button"
          aria-label={t("grade.title")}
          title={t("grade.title")}
          aria-expanded={open}
          className={`absolute right-2 top-2 z-10 rounded-control border p-1.5 shadow-sm transition-[color,background-color,border-color,opacity] duration-200 motion-reduce:transition-none focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 ${
            playing
              ? "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
              : "opacity-100"
          } ${
            open || active
              ? "border-primary bg-bg text-primary"
              : "border-white/30 bg-black/70 text-white hover:bg-black/90"
          }`}
          onClick={() => {
            setHeld(null);
            onOpenChange(!open);
          }}
          onKeyDown={(event) => {
            if (event.code === "Space") event.stopPropagation();
          }}
        >
          <SlidersHorizontal size={17} aria-hidden="true" />
        </button>
      )}
      {open &&
        container &&
        createPortal(
          <aside
            aria-label={t("grade.title")}
            // A sidebar beside the video: it stretches to the video's height
            // and grows past it when the controls need more.
            className="flex w-72 max-w-[45%] shrink-0 flex-col border-l border-border bg-bg"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") close();
            }}
          >
            <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <h2 className="truncate text-sm font-medium">
                {t("grade.title")}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="compact"
                className="ml-auto"
                aria-label={t("common.close")}
                title={`${t("common.close")} (Esc)`}
                onClick={close}
              >
                <X />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
              <section
                aria-labelledby={colorId}
                className="space-y-2 rounded-control border border-border bg-surface p-2"
              >
                <h3
                  id={colorId}
                  className="-mx-2 -mt-2 border-b border-border px-2 py-1.5 text-xs font-medium"
                >
                  {t("grade.color")}
                </h3>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={enabled ? "default" : "outline"}
                    aria-label={t("grade.toggle")}
                    aria-pressed={enabled}
                    disabled={failed}
                    title={t("grade.toggle")}
                    onClick={() => {
                      setHeld(null);
                      setEnabled(!enabled);
                    }}
                  >
                    <Power aria-hidden="true" />
                    {t(enabled ? "grade.on" : "grade.off")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      update(neutralGrade);
                      setHeld(null);
                      setFailed(false);
                    }}
                  >
                    {t("grade.resetAll")}
                  </Button>
                </div>
                <ToneCurve
                  grade={enabled && !failed ? previewGrade : neutralGrade}
                />
                <p id={hintId} className="text-xs text-muted">
                  {t("grade.holdHint")}
                </p>
                {gradeKeys.map((key) => {
                  const { min, max, step, neutral } = gradeControls[key];
                  const value = grade[key];
                  const directions =
                    key === "temperature"
                      ? ({
                          low: "grade.cool",
                          high: "grade.warm",
                          colors: ["text-blue-400", "text-orange-400"],
                        } as const)
                      : key === "tint"
                        ? ({
                            low: "grade.green",
                            high: "grade.magenta",
                            colors: ["text-green-400", "text-fuchsia-400"],
                          } as const)
                        : null;
                  const display =
                    key === "exposure"
                      ? `${value > 0 ? "+" : ""}${value.toFixed(2)} EV`
                      : key === "pivot"
                        ? `${Math.round(value * 100)}%`
                        : key === "contrast" || key === "saturation"
                          ? `${value.toFixed(2)}×`
                          : String(value);
                  return (
                    <div key={key} className="text-xs">
                      <div className="flex justify-between gap-2">
                        <button
                          type="button"
                          aria-pressed={held === key}
                          aria-describedby={hintId}
                          title={t("grade.holdHint")}
                          disabled={!enabled || failed || value === neutral}
                          className="touch-none select-none rounded-item text-left enabled:cursor-pointer enabled:hover:text-primary focus-visible:outline-2 focus-visible:outline-primary aria-pressed:text-primary"
                          onPointerDown={(event) => {
                            if (!event.isPrimary || event.button !== 0) return;
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            setHeld(key);
                          }}
                          onPointerUp={() => setHeld(null)}
                          onPointerCancel={() => setHeld(null)}
                          onLostPointerCapture={() => setHeld(null)}
                          onBlur={() => setHeld(null)}
                          onKeyDown={(event) => {
                            if (event.key !== " " && event.key !== "Enter")
                              return;
                            event.preventDefault();
                            if (!event.repeat) setHeld(key);
                          }}
                          onKeyUp={(event) => {
                            if (event.key !== " " && event.key !== "Enter")
                              return;
                            event.preventDefault();
                            setHeld(null);
                          }}
                        >
                          {t(`grade.${key}`)}
                        </button>
                        <span className="tabular-nums" aria-hidden="true">
                          {display}
                        </span>
                      </div>
                      <input
                        type="range"
                        className="w-full accent-primary"
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        aria-label={t(`grade.${key}`)}
                        aria-valuetext={
                          directions && value !== 0
                            ? `${display} ${t(value < 0 ? directions.low : directions.high)}`
                            : display
                        }
                        onChange={(event) =>
                          update({
                            ...grade,
                            [key]: Number(event.currentTarget.value),
                          })
                        }
                        onDoubleClick={() =>
                          update({ ...grade, [key]: neutral })
                        }
                      />
                      {directions && (
                        <span
                          aria-hidden="true"
                          className="flex justify-between text-2xs"
                        >
                          <span className={directions.colors[0]}>
                            {t(directions.low)}
                          </span>
                          <span className={directions.colors[1]}>
                            {t(directions.high)}
                          </span>
                        </span>
                      )}
                    </div>
                  );
                })}
                <p className="text-xs text-muted">
                  {t(failed ? "grade.unavailable" : "grade.preview")}
                </p>
              </section>
            </div>
          </aside>,
          container,
        )}
    </>
  );
}

function ToneCurve({ grade }: { grade: VideoGrade }) {
  // Higher visual resolution around middle gray, where small moves matter.
  const chart = (value: number) => Math.sqrt(value) * 100;
  const points = Array.from({ length: 65 }, (_, index) => {
    const x = index / 64;
    return `${x * 100},${100 - chart(videoToneCurve(x * x, grade))}`;
  }).join(" ");
  const pivotInput = toneCurvePivotInput(grade);
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-16 w-full rounded-item border border-border bg-bg"
    >
      <path
        d="M 0 100 L 100 0"
        stroke="currentColor"
        opacity="0.3"
        fill="none"
      />
      <polyline
        points={points}
        className="stroke-primary"
        vectorEffect="non-scaling-stroke"
        strokeWidth={2}
        fill="none"
      />
      {pivotInput <= 1 && (
        <circle
          cx={chart(pivotInput)}
          cy={100 - chart(grade.pivot)}
          r={2}
          className="fill-primary"
        />
      )}
    </svg>
  );
}

function GradedFrame({
  videoRef,
  grade,
  active,
  onError,
}: {
  videoRef: Props["videoRef"];
  grade: VideoGrade;
  active: boolean;
  onError: (failed: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ grade, active });
  const redraw = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    let frame: number | undefined;
    let stopped = false;
    let renderer: ReturnType<typeof createGradeRenderer>;
    try {
      renderer = createGradeRenderer(canvas);
    } catch (error) {
      log.warn("Video adjustments could not start", error);
      onError(true);
      return;
    }
    const failed = () => {
      stopped = true;
      canvas.style.visibility = "hidden";
      onError(true);
    };
    const draw = () => {
      if (
        stopped ||
        !settings.current.active ||
        video.readyState < 2 ||
        !video.videoWidth ||
        !video.videoHeight
      )
        return;
      try {
        renderer.draw(video, settings.current.grade);
        canvas.style.visibility = "visible";
      } catch (error) {
        log.warn("Video adjustments could not draw", error);
        failed();
      }
    };
    const queueFrame = () => {
      if (frame !== undefined || stopped || !settings.current.active) return;
      frame = video.requestVideoFrameCallback(() => {
        frame = undefined;
        draw();
        queueFrame();
      });
    };
    // Paused videos repaint on control changes, a resize, or seeking.
    const resize = new ResizeObserver(draw);
    resize.observe(canvas);
    canvas.addEventListener("webglcontextlost", failed);
    video.addEventListener("loadeddata", draw);
    video.addEventListener("seeked", draw);
    redraw.current = () => {
      if (!settings.current.active && frame !== undefined) {
        video.cancelVideoFrameCallback(frame);
        frame = undefined;
      }
      draw();
      queueFrame();
    };
    redraw.current();
    return () => {
      stopped = true;
      redraw.current = null;
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
      resize.disconnect();
      canvas.removeEventListener("webglcontextlost", failed);
      video.removeEventListener("loadeddata", draw);
      video.removeEventListener("seeked", draw);
      renderer.dispose();
    };
  }, [videoRef, onError]);

  useLayoutEffect(() => {
    settings.current = { grade, active };
    if (!active && canvasRef.current)
      canvasRef.current.style.visibility = "hidden";
    redraw.current?.();
  }, [grade, active]);

  return (
    <canvas
      ref={canvasRef}
      data-slot="graded-video"
      aria-hidden="true"
      style={{ visibility: "hidden" }}
      className="pointer-events-none absolute inset-0 h-full w-full object-contain"
    />
  );
}
