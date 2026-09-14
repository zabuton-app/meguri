// The Web Audio tap behind the spectrum display: one AudioContext, one
// MediaElementAudioSourceNode per element (the platform allows exactly one —
// a second createMediaElementSource() on the same element throws) and an
// AnalyserNode between the element and the speakers.
//
// Attaching is a one-way door. Once an element is routed through the graph its
// sound only reaches the speakers via the context, so the graph stays connected
// for the element's lifetime and the context has to be running whenever the
// element plays. The tap therefore owns that lifecycle itself, from the
// element's own events: `play` wakes the context, and a pause or an end puts it
// to sleep a little later (the app lives in the tray, so a context left running
// would keep the audio thread awake for the rest of the session). Nothing is
// built until the first display asks for it, so a session that never shows a
// spectrum never pays for a context.
//
// The element must be loaded with crossOrigin="anonymous": the media server
// is a different origin from the renderer, and an opaque (non-CORS) source
// feeds the analyser silence. The server answers with
// Access-Control-Allow-Origin: * (see electron/core/server.ts).
import log from "@/lib/logger";

interface Tap {
  ctx: AudioContext;
  /** Null when the element had to be wired straight to the speakers because
   *  the analyser could not be put in between (it still sounds). */
  analyser: AnalyserNode | null;
}

// A null entry records a failed attempt, so the display does not retry (and
// leak a context) on every play/pause.
const taps = new WeakMap<HTMLMediaElement, Tap | null>();

// 4096 gives 2048 bins (~11.7 Hz each at 48 kHz): fine enough for the
// log-spaced bands the display draws to tell the bass bands apart, while the
// ~85 ms window still follows a beat. The FFT cost at this size is negligible.
export const SPECTRUM_FFT_SIZE = 4096;
// Per-frame smoothing inside the analyser itself; the display adds its own
// decay on top so that a pause falls away rather than freezing.
const SMOOTHING = 0.75;
// How long after a pause the context is suspended: longer than the display's
// decay (about a second), short enough that a track left paused does not keep
// the audio thread up.
export const SUSPEND_AFTER_MS = 4000;

/**
 * The analyser for `el`, built on first use. Null where Web Audio is
 * unavailable (jsdom) or the graph could not be built, in which case the
 * element keeps playing exactly as before — the display just has nothing to
 * draw.
 */
export function attachAnalyser(el: HTMLMediaElement): AnalyserNode | null {
  if (taps.has(el)) return taps.get(el)?.analyser ?? null;
  if (typeof AudioContext === "undefined") return null;
  let ctx: AudioContext | null = null;
  let built: Tap;
  try {
    ctx = new AudioContext();
    // Everything that can fail without consequence goes first: until the
    // source exists the element still sounds on its own, and a failure here
    // just means no tap. Creating the source is the point of no return.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = SPECTRUM_FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;
    analyser.connect(ctx.destination);
    const source = ctx.createMediaElementSource(el);
    const tap: Tap = { ctx, analyser };
    try {
      source.connect(analyser);
    } catch (e) {
      // The element is already rerouted; leaving it unconnected would mute
      // it. Straight to the speakers, then, and no spectrum.
      log.warn("audio analyser could not be inserted:", e);
      source.connect(ctx.destination);
      tap.analyser = null;
    }
    taps.set(el, tap);
    built = tap;
  } catch (e) {
    log.warn("audio analyser unavailable:", e);
    taps.set(el, null);
    if (ctx) void ctx.close().catch(() => {});
    return null;
  }
  // Outside the try: the element is on the graph now, and the catch above
  // would close the context under it.
  follow(el, built);
  return built.analyser;
}

/** Keep the context's state in step with the element's. */
function follow(el: HTMLMediaElement, { ctx }: Tap): void {
  let sleep: ReturnType<typeof setTimeout> | null = null;
  const wake = () => {
    if (sleep) {
      clearTimeout(sleep);
      sleep = null;
    }
    if (ctx.state === "suspended")
      void ctx.resume().catch((e: unknown) => {
        log.warn("audio context resume failed:", e);
      });
  };
  const rest = () => {
    if (sleep) clearTimeout(sleep);
    sleep = setTimeout(() => {
      sleep = null;
      // Only while still paused: suspending mid-playback would mute it.
      if (el.paused && ctx.state === "running")
        void ctx.suspend().catch((e: unknown) => {
          log.warn("audio context suspend failed:", e);
        });
    }, SUSPEND_AFTER_MS);
  };
  el.addEventListener("play", wake);
  el.addEventListener("pause", rest);
  el.addEventListener("ended", rest);
  // The platform can suspend a context on its own (an output device change,
  // for one). The element does not fire `play` again, so it would go on
  // silently; wake the context back up as long as the element is sounding.
  ctx.addEventListener("statechange", () => {
    if (ctx.state === "suspended" && !el.paused) wake();
  });
  // Start in step with the element: a context created outside a user gesture
  // can start suspended while the element is already sounding (silence here
  // would be a regression caused by merely opening the display), and one
  // created while the element is paused — the display mounts before the
  // track starts — would otherwise run until a later pause.
  if (el.paused) rest();
  else wake();
}
