import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AlignResponse } from "../alignProtocol";
import { useAlignment } from "../useAlignment";

class FakeWorker {
  onmessage: ((e: MessageEvent<AlignResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  answer(msg: AlignResponse) {
    this.onmessage?.({ data: msg } as MessageEvent<AlignResponse>);
  }
}

function setup(a = "http://m/ws/w/media/1", b = "http://m/ws/w/media/2") {
  const worker = new FakeWorker();
  const create = () => worker as unknown as Worker;
  const hook = renderHook(({ a, b }) => useAlignment(a, b, create), {
    initialProps: { a, b },
  });
  return { worker, hook };
}

describe("useAlignment", () => {
  it("sends the pair and reports progress, then the result", () => {
    const { worker, hook } = setup();
    expect(worker.postMessage).toHaveBeenCalledWith({
      a: "http://m/ws/w/media/1",
      b: "http://m/ws/w/media/2",
    });
    expect(hook.result.current).toEqual({ status: "loading" });

    act(() => worker.answer({ type: "progress", fraction: 0.5 }));
    expect(hook.result.current).toEqual({ status: "matching", fraction: 0.5 });
    expect(worker.terminate).not.toHaveBeenCalled();

    act(() =>
      worker.answer({
        type: "result",
        dx: 4,
        dy: -2,
        scale: 1.5,
        score: 0.9,
      }),
    );
    expect(hook.result.current).toEqual({
      status: "done",
      dx: 4,
      dy: -2,
      scale: 1.5,
      score: 0.9,
    });
  });

  it("ends the worker as soon as it answers, so its heap is let go", () => {
    const { worker } = setup();
    act(() =>
      worker.answer({
        type: "result",
        dx: 0,
        dy: 0,
        scale: 1,
        score: 1,
      }),
    );
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("reports an error the worker sends, or one it dies of", () => {
    const sent = setup();
    act(() => sent.worker.answer({ type: "error", message: "HTTP 404" }));
    expect(sent.hook.result.current).toEqual({ status: "error" });
    expect(sent.worker.terminate).toHaveBeenCalled();

    const died = setup();
    act(() => died.worker.onerror?.({ message: "boom" } as ErrorEvent));
    expect(died.hook.result.current).toEqual({ status: "error" });
  });

  it("waits for the media server's address before starting", () => {
    const { worker } = setup("", "");
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("stops a search still running when the view closes", () => {
    const { worker, hook } = setup();
    hook.unmount();
    expect(worker.terminate).toHaveBeenCalled();
  });
});
