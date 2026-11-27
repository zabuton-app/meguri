import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  createImageLimiter,
  filmstripInFlight,
  useLimitedImage,
} from "@/filmstrip/imageLimiter";

type Pending = {
  url: string;
  signal: AbortSignal | undefined;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
};

/** A fetch whose calls stay pending until the test settles them. */
function deferredFetch() {
  const calls: Pending[] = [];
  const fetchImpl = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal ?? undefined;
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
        calls.push({ url: input as string, signal, resolve, reject });
      }),
  ) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ok = () => new Response(new Blob(["x"]), { status: 200 });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("filmstripInFlight", () => {
  it("leaves one of the server's decode slots free, using at least two", () => {
    expect(filmstripInFlight(6)).toBe(5);
    expect(filmstripInFlight(3)).toBe(2);
    expect(filmstripInFlight(2)).toBe(2);
  });

  it("uses two when the slot count is not known", () => {
    expect(filmstripInFlight(undefined)).toBe(2);
  });
});

describe("createImageLimiter", () => {
  it("keeps at most `max` loads in flight and starts the rest in order", async () => {
    const { calls, fetchImpl } = deferredFetch();
    const limiter = createImageLimiter(2, fetchImpl);
    const loads = ["a", "b", "c", "d", "e"].map((u) =>
      limiter.load(u, new AbortController().signal),
    );
    await flush();
    expect(calls.map((c) => c.url)).toEqual(["a", "b"]);
    calls[1].resolve(ok());
    await loads[1];
    await flush();
    expect(calls.map((c) => c.url)).toEqual(["a", "b", "c"]);
    calls[0].resolve(ok());
    await loads[0];
    await flush();
    expect(calls.map((c) => c.url)).toEqual(["a", "b", "c", "d"]);
  });

  it("drops a waiting load whose signal aborts, without fetching it", async () => {
    const { calls, fetchImpl } = deferredFetch();
    const limiter = createImageLimiter(1, fetchImpl);
    void limiter.load("a", new AbortController().signal);
    const ac = new AbortController();
    const waiting = limiter.load("b", ac.signal);
    ac.abort();
    await expect(waiting).rejects.toBeDefined();
    calls[0].resolve(ok());
    await flush();
    expect(calls.map((c) => c.url)).toEqual(["a"]);
  });

  it("aborts an in-flight load's fetch and frees its slot", async () => {
    const { calls, fetchImpl } = deferredFetch();
    const limiter = createImageLimiter(1, fetchImpl);
    const ac = new AbortController();
    const first = limiter.load("a", ac.signal);
    void limiter.load("b", new AbortController().signal);
    await flush();
    ac.abort();
    await expect(first).rejects.toBeDefined();
    expect(calls[0].signal?.aborted).toBe(true);
    await flush();
    expect(calls.map((c) => c.url)).toEqual(["a", "b"]);
  });

  it("rejects a response that is not OK", async () => {
    const { calls, fetchImpl } = deferredFetch();
    const limiter = createImageLimiter(1, fetchImpl);
    const load = limiter.load("a", new AbortController().signal);
    await flush();
    calls[0].resolve(new Response(null, { status: 503 }));
    await expect(load).rejects.toBeDefined();
  });
});

describe("useLimitedImage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives an object URL and revokes it on unmount", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:one");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    const limiter = createImageLimiter(2, fetchImpl);
    const { result, unmount } = renderHook(() =>
      useLimitedImage(limiter, "http://x/frame"),
    );
    await waitFor(() => expect(result.current.src).toBe("blob:one"));
    expect(create).toHaveBeenCalledTimes(1);
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:one");
  });

  it("reports a failed load", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;
    const limiter = createImageLimiter(2, fetchImpl);
    const { result } = renderHook(() =>
      useLimitedImage(limiter, "http://x/frame"),
    );
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.src).toBeUndefined();
  });

  it("makes no request for a null URL", async () => {
    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    const limiter = createImageLimiter(2, fetchImpl);
    const { result } = renderHook(() => useLimitedImage(limiter, null));
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current).toEqual({ src: undefined, failed: false });
  });
});
