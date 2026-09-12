// useLogo carries non-trivial optimistic-update behavior (cancel the initial
// fetch, serialize mutations, roll back on failure), so each path is pinned
// here against regressions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LogoId } from "@shared/ipc/schema";

const logoGet = vi.fn<() => Promise<LogoId>>();
const logoSet = vi.fn<(logo: LogoId) => Promise<LogoId>>();
vi.mock("@/ipc/client", () => ({
  api: {
    logoGet: (): Promise<LogoId> => logoGet(),
    logoSet: (logo: LogoId): Promise<LogoId> => logoSet(logo),
  },
}));

const { useLogo } = await import("@/hooks/useLogo");

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  logoGet.mockReset();
  logoSet.mockReset();
});

describe("useLogo", () => {
  it("falls back to dark until the initial fetch resolves, then reports it", async () => {
    logoGet.mockResolvedValue("light");
    const { result } = renderHook(() => useLogo(), { wrapper });
    expect(result.current.logo).toBe("dark");
    await waitFor(() => expect(result.current.logo).toBe("light"));
  });

  it("applies optimistically and settles on main's echoed value", async () => {
    logoGet.mockResolvedValue("dark");
    const echo = deferred<LogoId>();
    logoSet.mockReturnValue(echo.promise);
    const { result } = renderHook(() => useLogo(), { wrapper });
    await waitFor(() => expect(logoGet).toHaveBeenCalled());

    act(() => result.current.setLogo("enso"));
    // Optimistic: visible while the IPC is still pending (echo unresolved).
    await waitFor(() => expect(result.current.logo).toBe("enso"));
    expect(logoSet).toHaveBeenCalledWith("enso");

    await act(async () => echo.resolve("enso"));
    expect(result.current.logo).toBe("enso");
  });

  it("rolls back to the previous value when the IPC fails", async () => {
    logoGet.mockResolvedValue("light");
    logoSet.mockRejectedValue(new Error("ipc down"));
    const { result } = renderHook(() => useLogo(), { wrapper });
    await waitFor(() => expect(result.current.logo).toBe("light"));

    act(() => result.current.setLogo("enso"));
    await waitFor(() => expect(result.current.logo).toBe("light"));
    expect(logoSet).toHaveBeenCalledWith("enso");
  });

  it("does not let a slow initial fetch overwrite an optimistic pick", async () => {
    const initial = deferred<LogoId>();
    logoGet.mockReturnValue(initial.promise);
    logoSet.mockImplementation((logo) => Promise.resolve(logo));
    const { result } = renderHook(() => useLogo(), { wrapper });

    act(() => result.current.setLogo("enso"));
    await waitFor(() => expect(result.current.logo).toBe("enso"));

    // The pre-pick fetch resolving late must not roll the cache back.
    await act(async () => initial.resolve("dark"));
    expect(result.current.logo).toBe("enso");
  });

  it("skips the IPC when re-picking the active variant", async () => {
    logoGet.mockResolvedValue("light");
    logoSet.mockImplementation((logo) => Promise.resolve(logo));
    const { result } = renderHook(() => useLogo(), { wrapper });
    await waitFor(() => expect(result.current.logo).toBe("light"));

    act(() => result.current.setLogo("light"));
    expect(logoSet).not.toHaveBeenCalled();
  });
});
