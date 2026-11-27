import { useEffect, useState } from "react";

/**
 * Frame and waveform requests the filmstrip keeps in flight at once. Each is
 * an ffmpeg run on one of the server's decode slots (2 to 6, by the CPU
 * count), shared with seek previews, thumbnails and the scan, and the server
 * sheds requests beyond its waiting queue, so the view queues its own instead
 * of firing a screenful at once. It takes every slot but one, so a seek
 * preview still gets one; never fewer than two. More would only queue at the
 * server.
 */
export function filmstripInFlight(decodeSlots: number | undefined): number {
  return Math.max(2, (decodeSlots ?? 0) - 1);
}

export type ImageLimiter = {
  /** Fetch `url` once a slot is free. Rejects on abort or a non-OK response. */
  load(url: string, signal: AbortSignal): Promise<Blob>;
};

const abortError = () => new DOMException("Aborted", "AbortError");

type Waiter = { start: () => void; signal: AbortSignal };

export function createImageLimiter(
  max: number,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): ImageLimiter {
  let active = 0;
  const queue: Waiter[] = [];
  // Urls the server failed: asked again they would fail again (a waveform
  // past the request timeout holds a decode slot for a minute each time), so
  // they are not, for the limiter's lifetime (the view's). A 503 only says
  // the server was busy and is asked again.
  const failed = new Set<string>();

  const next = () => {
    while (active < max && queue.length > 0) {
      const w = queue.shift()!;
      if (w.signal.aborted) continue;
      w.start();
    }
  };

  return {
    load(url, signal) {
      return new Promise<Blob>((resolve, reject) => {
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        if (failed.has(url)) {
          reject(new Error("failed before"));
          return;
        }
        const waiter: Waiter = {
          signal,
          start: () => {
            signal.removeEventListener("abort", onWaitAbort);
            active++;
            fetchImpl(url, { signal })
              .then((res) => {
                if (!res.ok) {
                  if (res.status !== 503) failed.add(url);
                  throw new Error(`HTTP ${res.status}`);
                }
                return res.blob();
              })
              .then(resolve, reject)
              .finally(() => {
                active--;
                next();
              });
          },
        };
        // While waiting, an abort only takes the load out of the queue.
        const onWaitAbort = () => {
          const i = queue.indexOf(waiter);
          if (i >= 0) queue.splice(i, 1);
          reject(abortError());
        };
        signal.addEventListener("abort", onWaitAbort, { once: true });
        queue.push(waiter);
        next();
      });
    },
  };
}

/**
 * Load `url` through `limiter` as an object URL. A null url loads nothing; a
 * change of url or an unmount aborts the load and revokes the object URL.
 */
export function useLimitedImage(
  limiter: ImageLimiter,
  url: string | null,
): { src: string | undefined; failed: boolean } {
  const [state, setState] = useState<{
    url: string | null;
    src: string | undefined;
    failed: boolean;
  }>({ url: null, src: undefined, failed: false });

  useEffect(() => {
    if (url == null) return;
    const ac = new AbortController();
    let objectUrl: string | undefined;
    limiter.load(url, ac.signal).then(
      (blob) => {
        if (ac.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url, src: objectUrl, failed: false });
      },
      () => {
        if (!ac.signal.aborted) setState({ url, src: undefined, failed: true });
      },
    );
    return () => {
      ac.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      // Forget the result with its object URL: the same url coming back (a
      // row scrolled off and on) must load again, not reuse a revoked one.
      setState({ url: null, src: undefined, failed: false });
    };
  }, [limiter, url]);

  // A result for another url (or none) is not this url's.
  if (url == null || state.url !== url)
    return { src: undefined, failed: false };
  return { src: state.src, failed: state.failed };
}
