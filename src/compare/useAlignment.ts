// Runs align.worker.ts for one pair of images. One worker per pair, ended as
// soon as it answers: OpenCV's wasm heap never shrinks, so a worker kept alive
// would hold the decoded images' memory for as long as the view is open.
// Ending it is also how a search still running is stopped when the view closes.
import { useEffect, useState } from "react";
import log from "@/lib/logger";
import type { AlignResult } from "./alignImages";
import type { AlignRequest, AlignResponse } from "./alignProtocol";

export type AlignState =
  | { status: "loading" }
  | { status: "matching"; fraction: number }
  | ({ status: "done" } & AlignResult)
  | { status: "error" };

const createAlignWorker = (): Worker =>
  new Worker(new URL("./align.worker.ts", import.meta.url), {
    type: "module",
  });

export function useAlignment(
  a: string,
  b: string,
  create: () => Worker = createAlignWorker,
): AlignState {
  const [state, setState] = useState<AlignState>({ status: "loading" });

  // The pair is fixed for the life of the view; the URLs change only once,
  // from "" to the media server's, when its address arrives.
  useEffect(() => {
    if (!a || !b) return;
    // A failure to start arrives as an error event, not as a throw: the URL
    // is the bundler's own.
    const worker = create();
    worker.onmessage = (e: MessageEvent<AlignResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setState({ status: "matching", fraction: msg.fraction });
        return;
      }
      worker.terminate();
      if (msg.type === "result") {
        const { dx, dy, scale, score } = msg;
        setState({ status: "done", dx, dy, scale, score });
      } else {
        log.warn("image alignment failed:", msg.message);
        setState({ status: "error" });
      }
    };
    worker.onerror = (e) => {
      log.warn("image alignment worker failed:", e.message);
      worker.terminate();
      setState({ status: "error" });
    };
    worker.postMessage({ a, b } satisfies AlignRequest);
    return () => worker.terminate();
  }, [a, b, create]);

  return state;
}
