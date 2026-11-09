// useCustomCssStyle is what puts the user stylesheet on screen: it must follow
// the switch, follow saves pushed from main, and never let a late save bring
// the stylesheet back after the switch went off.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CustomCssChanged, CustomCssState } from "@shared/ipc/channels";

const customCssGet = vi.fn<() => Promise<CustomCssState>>();
const customCssSetEnabled =
  vi.fn<(enabled: boolean) => Promise<CustomCssState>>();
let emitChanged: ((e: CustomCssChanged) => void) | null = null;
vi.mock("@/ipc/client", () => ({
  api: {
    customCssGet: () => customCssGet(),
    customCssSetEnabled: (enabled: boolean) => customCssSetEnabled(enabled),
  },
  events: {
    onCustomCssChanged: (cb: (e: CustomCssChanged) => void) => {
      emitChanged = cb;
      return Promise.resolve(() => {
        emitChanged = null;
      });
    },
  },
}));

const { useCustomCss, useCustomCssStyle } =
  await import("@/hooks/useCustomCss");

const PATH = "/home/u/.config/meguri/custom.css";
const styleText = () =>
  document.getElementById("meguri-custom-css")?.textContent ?? null;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderBoth() {
  return renderHook(
    () => {
      useCustomCssStyle();
      return useCustomCss();
    },
    { wrapper },
  );
}

beforeEach(() => {
  customCssGet.mockReset();
  customCssSetEnabled.mockReset();
});

afterEach(() => {
  document.getElementById("meguri-custom-css")?.remove();
});

describe("useCustomCssStyle", () => {
  it("injects the stylesheet when it is on", async () => {
    customCssGet.mockResolvedValue({
      enabled: true,
      path: PATH,
      css: "html{--c-bg:#000}",
    });
    renderBoth();
    await waitFor(() => expect(styleText()).toBe("html{--c-bg:#000}"));
  });

  it("injects nothing while it is off", async () => {
    customCssGet.mockResolvedValue({ enabled: false, path: PATH, css: null });
    const { result } = renderBoth();
    await waitFor(() => expect(result.current.state).toBeDefined());
    expect(styleText()).toBe("");
  });

  it("follows the switch both ways", async () => {
    customCssGet.mockResolvedValue({ enabled: false, path: PATH, css: null });
    const { result } = renderBoth();
    await waitFor(() => expect(result.current.state).toBeDefined());

    customCssSetEnabled.mockResolvedValue({
      enabled: true,
      path: PATH,
      css: "a{}",
    });
    act(() => result.current.setEnabled(true));
    await waitFor(() => expect(styleText()).toBe("a{}"));
    expect(customCssSetEnabled).toHaveBeenCalledWith(true);

    customCssSetEnabled.mockResolvedValue({
      enabled: false,
      path: PATH,
      css: null,
    });
    act(() => result.current.setEnabled(false));
    await waitFor(() => expect(styleText()).toBe(""));
  });

  it("applies a save pushed from main, and clears on deletion", async () => {
    customCssGet.mockResolvedValue({ enabled: true, path: PATH, css: "a{}" });
    renderBoth();
    await waitFor(() => expect(styleText()).toBe("a{}"));

    act(() => emitChanged?.({ css: "b{}" }));
    await waitFor(() => expect(styleText()).toBe("b{}"));

    act(() => emitChanged?.({ css: null }));
    await waitFor(() => expect(styleText()).toBe(""));
  });

  it("ignores a save that lands after the switch went off", async () => {
    customCssGet.mockResolvedValue({ enabled: true, path: PATH, css: "a{}" });
    const { result } = renderBoth();
    await waitFor(() => expect(styleText()).toBe("a{}"));

    customCssSetEnabled.mockResolvedValue({
      enabled: false,
      path: PATH,
      css: null,
    });
    act(() => result.current.setEnabled(false));
    await waitFor(() => expect(result.current.state?.enabled).toBe(false));

    act(() => emitChanged?.({ css: "late{}" }));
    expect(styleText()).toBe("");
    expect(result.current.state?.css).toBeNull();
  });
});
