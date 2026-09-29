// SimClient against a stand-in worker: generations, frame batching, idle, and
// carrying on when the worker dies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SimRequest, SimResponse } from "../sim/protocol";
import { SimClient } from "../sim/simClient";

class FakeWorker {
  static last: FakeWorker | null = null;
  sent: SimRequest[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<SimResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(msg: SimRequest) {
    this.sent.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  reply(msg: SimResponse) {
    this.onmessage?.({ data: msg } as MessageEvent<SimResponse>);
  }
}

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) =>
    setTimeout(() => f(0), 0),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function input() {
  return {
    dims: 2 as const,
    pos: new Float32Array([0, 0, 1, 1]),
    links: new Uint32Array([0, 1]),
    alpha: 1,
    pins: [],
  };
}

describe("SimClient", () => {
  it("delivers only the latest generation, once per frame", async () => {
    const client = new SimClient();
    const onPositions = vi.fn();
    const onIdle = vi.fn();
    client.setCallbacks({ onPositions, onIdle });
    const first = client.load(input());
    const second = client.load(input());
    const w = FakeWorker.last!;
    w.reply({ type: "positions", gen: first, pos: new Float32Array([9, 9]) });
    w.reply({ type: "positions", gen: second, pos: new Float32Array([1, 2]) });
    w.reply({ type: "positions", gen: second, pos: new Float32Array([3, 4]) });
    await new Promise((r) => setTimeout(r, 5));
    expect(onPositions).toHaveBeenCalledTimes(1);
    expect(Array.from(onPositions.mock.calls[0][0] as Float32Array)).toEqual([
      3, 4,
    ]);
    w.reply({ type: "idle", gen: first });
    expect(onIdle).not.toHaveBeenCalled();
    w.reply({ type: "idle", gen: second });
    expect(onIdle).toHaveBeenCalledWith(second);
  });

  it("releases without a node when the dragged one is gone", () => {
    const client = new SimClient();
    client.load(input());
    const w = FakeWorker.last!;
    w.sent = [];
    client.release(null);
    expect(w.sent).toEqual([{ type: "heat", alphaTarget: 0 }]);
  });

  it("goes on without the worker once it has died", async () => {
    const client = new SimClient();
    const onIdle = vi.fn();
    client.setCallbacks({ onPositions: vi.fn(), onIdle });
    client.load(input());
    const w = FakeWorker.last!;
    w.onerror?.({ message: "boom" } as ErrorEvent);
    expect(w.terminated).toBe(true);
    const gen = client.load(input());
    await Promise.resolve();
    expect(onIdle).toHaveBeenLastCalledWith(gen);
    expect(FakeWorker.last).toBe(w);
  });
});
