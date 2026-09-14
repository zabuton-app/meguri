// A live frequency spectrum of whatever the bar's element is playing, in the
// pattern chosen in Settings (see spectrumPatterns.ts), drawn from the
// analyser in analyser.ts. It works on any surface (the detail stage, the
// side peek, the playlist stage) without those surfaces owning any audio of
// their own; the host only says which mode fits its box.
//
// The host says whether its track is the one sounding (`active`); while it
// is, the levels follow the analyser every frame, and when it stops they fall
// away over a moment rather than freezing at the last frame or vanishing.
// Off entirely under the "audio spectrum" preference and under the OS
// reduce-motion setting.
import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/themes/ThemeProvider";
import { useAudioActions } from "./useAudioPlayer";
import { useSpectrumPattern } from "./useSpectrumPattern";
import { bandEdges } from "./spectrumBands";
import {
  bandColors,
  bandCount,
  DRAWERS,
  PALETTE_TOKENS,
  type SpectrumMode,
  type SpectrumPalette,
} from "./spectrumPatterns";

interface Props {
  /** Whether the host's track is the one playing in the bar. */
  active: boolean;
  /** Which box the display is in (decides the pattern's geometry). */
  mode: SpectrumMode;
  /** Positions and sizes the box (a wrapper; the canvas itself always fills
   *  it). */
  className?: string;
}

// How fast a level chases its target, in 1/s: quick on the way up so a beat
// lands, slower on the way down so it falls rather than cuts. Applied as an
// exponential step (1 - e^(-rate·dt)), so the fall takes the same moment at
// any frame rate: a full bar drains in about 0.9 s.
const ATTACK = 22;
const RELEASE = 6;
// Levels below this are treated as silent: a drained, paused display stops
// asking for frames.
const MIN_LEVEL = 0.005;
// The patterns have no fine detail; beyond this the bitmap only costs memory
// and fill — and on a large stage even 2x is more fill per frame than a
// software rasteriser enjoys, so the bitmap's long edge is capped as well.
const MAX_DPR = 2;
const MAX_BITMAP_EDGE = 2048;
// A frame can stall (a hidden window); clamp the step so the levels do not
// leap when it resumes.
const MAX_DT = 0.05;

function readPalette(el: Element): SpectrumPalette {
  const cs = getComputedStyle(el);
  const entries = Object.entries(PALETTE_TOKENS).map(([key, token]) => [
    key,
    cs.getPropertyValue(`--c-${token}`).trim() || "#ffffff",
  ]);
  return Object.fromEntries(entries) as SpectrumPalette;
}

export function AudioSpectrum({ active, mode, className }: Props) {
  const { ensureAnalyser } = useAudioActions();
  const pattern = useSpectrumPattern();
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Band levels (0..1) carried across effect runs, so a pause → play within a
  // fall does not restart from zero and a resize keeps the current picture.
  const levelsRef = useRef<Float32Array | null>(null);
  // `active` is read by the frame loop through a ref rather than being a
  // dependency: a play/pause must not tear the loop, the observers and the
  // buffers down and up again (and blank a frame in between).
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);
  // Restarts the loop after it stopped on a drained display; set by the
  // effect below, called when `active` flips back on.
  const kickRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (active) kickRef.current?.();
  }, [active]);

  useEffect(() => {
    if (!pattern) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    const analyser = ensureAnalyser();
    if (!analyser) return;

    const bars = bandCount(pattern, mode);
    const bins = analyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    const edges = bandEdges(bars, bins, analyser.context.sampleRate);
    if (!levelsRef.current || levelsRef.current.length !== bars)
      levelsRef.current = new Float32Array(bars);
    const levels = levelsRef.current;
    const draw = DRAWERS[pattern];

    // The theme is an effect dependency, so the palette is read once per
    // theme — but from the first frame, not here: ThemeProvider writes the
    // new `data-theme` in its own effect, which runs after this one (effects
    // flush child-first), so reading now would see the old theme's colours.
    let palette: SpectrumPalette | null = null;
    let colors: string[] = [];
    let dpr = 1;
    let width = 0;
    let height = 0;
    const wantedDpr = () =>
      Math.min(
        window.devicePixelRatio || 1,
        MAX_DPR,
        MAX_BITMAP_EDGE / Math.max(1, canvas.clientWidth, canvas.clientHeight),
      );
    const resize = () => {
      dpr = wantedDpr();
      width = Math.max(1, canvas.clientWidth);
      height = Math.max(1, canvas.clientHeight);
      const bw = Math.round(width * dpr);
      const bh = Math.round(height * dpr);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
    };
    resize();

    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      raf = 0;
      if (!palette) {
        palette = readPalette(canvas);
        colors = bandColors(palette, bars);
      }
      // A move to a display with another scale changes the ratio without
      // changing the CSS box, which the ResizeObserver would not notice.
      if (wantedDpr() !== dpr) resize();
      const dt = last ? Math.min(MAX_DT, (now - last) / 1000) : 1 / 60;
      last = now;
      const active = activeRef.current;
      if (active) analyser.getByteFrequencyData(data);
      let visible = false;
      for (let i = 0; i < bars; i++) {
        const from = edges[i];
        let target = 0;
        if (active && from < bins) {
          const to = Math.min(bins, Math.max(from + 1, edges[i + 1]));
          let sum = 0;
          for (let b = from; b < to; b++) sum += data[b];
          target = sum / (to - from) / 255;
        }
        const cur = levels[i];
        const rate = target > cur ? ATTACK : RELEASE;
        const next = cur + (target - cur) * (1 - Math.exp(-rate * dt));
        levels[i] = next < MIN_LEVEL ? 0 : next;
        if (levels[i] > 0) visible = true;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      draw({ g, w: width, h: height, mode, levels, palette, colors, active });
      // Keep going while there is something on screen (a fall in progress)
      // or the track is sounding; a drained, paused display costs nothing.
      if (active || visible) raf = requestAnimationFrame(frame);
      else last = 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    kickRef.current = kick;
    kick();

    // Follow the box: the peek is resizable, the stage follows the window.
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            resize();
            kick();
          });
    ro?.observe(canvas);

    return () => {
      kickRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [pattern, mode, ensureAnalyser, theme]);

  if (!pattern) return null;
  return (
    // The wrapper takes the host's box; the canvas fills it. A canvas is a
    // replaced element, so an unset dimension would follow the bitmap size
    // this component keeps setting, and the two would chase each other
    // through the ResizeObserver forever.
    <div className={cn("pointer-events-none", className)} aria-hidden>
      <canvas
        ref={canvasRef}
        data-testid="audio-spectrum"
        data-pattern={pattern}
        className="block h-full w-full"
      />
    </div>
  );
}
