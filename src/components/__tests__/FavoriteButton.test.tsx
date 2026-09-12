// Regression test for the favorite toggle's optimistic cache sync: clicking must call the
// IPC mutation and patch the discovery queue cache in place (it is never refetched).
// Also covers the spec-009 effect animation: burst on add / settle on remove, fired
// only by direct activation of this control instance (never by prop changes), and
// restarted cleanly on rapid re-activation.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fileSetFavorite = vi.fn().mockResolvedValue(undefined);
vi.mock("@/ipc/client", () => ({
  api: {
    fileSetFavorite: (...args: unknown[]): Promise<void> =>
      fileSetFavorite(...args) as Promise<void>,
  },
  ALL_ID: "__all__",
}));

// Imported after the mock so FavoriteButton picks up the stubbed client.
const { FavoriteButton } = await import("@/components/FavoriteButton");
const { I18nProvider } = await import("@/i18n/I18nProvider");

function setup(favorite: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    ["files_random"],
    [{ id: 1, workspaceId: "ws", favorite, relPath: "a.mp4", kind: "video" }],
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
  const view = render(
    <FavoriteButton fileId={1} workspaceId="ws" favorite={favorite} />,
    { wrapper },
  );
  const rerenderWith = (fav: number) =>
    view.rerender(<FavoriteButton fileId={1} workspaceId="ws" favorite={fav} />);
  return { qc, rerenderWith };
}

const burst = () => document.querySelectorAll('[data-testid="fx-burst"]');
const popWrapper = () => document.querySelectorAll(".fx-pop");
const settleWrapper = () => document.querySelectorAll(".fx-settle");

describe("FavoriteButton", () => {
  it("toggles on: calls the mutation and patches the files_random cache row to favorite=1", async () => {
    const { qc } = setup(0);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(btn);

    await waitFor(() =>
      expect(fileSetFavorite).toHaveBeenCalledWith(1, "ws", true),
    );
    await waitFor(() => {
      const rows = qc.getQueryData<{ id: number; favorite: number }[]>([
        "files_random",
      ]);
      expect(rows?.[0].favorite).toBe(1);
    });
  });

  it("reflects the current favorite state via aria-pressed", () => {
    setup(1);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("plays the celebratory burst + pop when adding a favorite", () => {
    setup(0);
    expect(burst().length).toBe(0);
    expect(popWrapper().length).toBe(0);

    fireEvent.click(screen.getByRole("button"));

    expect(popWrapper().length).toBe(1);
    expect(burst().length).toBe(1);
    expect(settleWrapper().length).toBe(0);
  });

  it("plays the subtler settle (no particles) when removing a favorite", () => {
    setup(1);

    fireEvent.click(screen.getByRole("button"));

    expect(settleWrapper().length).toBe(1);
    expect(burst().length).toBe(0);
    expect(popWrapper().length).toBe(0);
  });

  it("restarts cleanly on rapid re-activation: never more than one overlay", async () => {
    setup(0);
    const btn = screen.getByRole("button");

    fireEvent.click(btn);
    // Wait out the pending mutation (the button is disabled while in flight).
    await waitFor(() =>
      expect((btn as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(btn);

    // The prop stays 0 here (no parent re-render), so both activations are
    // "add": exactly one pop wrapper, one burst, one heart icon. The previous
    // activation's DOM must be fully replaced, not left behind (regression:
    // equal sibling keys once corrupted reconciliation and stale wrappers
    // accumulated).
    expect(popWrapper().length).toBe(1);
    expect(settleWrapper().length).toBe(0);
    expect(burst().length).toBe(1);
    expect(document.querySelectorAll("svg.lucide-heart").length).toBe(1);
  });

  it("never fires the effect from prop changes (cache sync from other views)", () => {
    const { rerenderWith } = setup(0);

    rerenderWith(1);

    expect(burst().length).toBe(0);
    expect(popWrapper().length).toBe(0);
    expect(settleWrapper().length).toBe(0);
  });

  it("suppresses all decorative effects under prefers-reduced-motion while still mutating", async () => {
    const orig = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      setup(0);

      fireEvent.click(screen.getByRole("button"));

      expect(burst().length).toBe(0);
      expect(popWrapper().length).toBe(0);
      expect(settleWrapper().length).toBe(0);
      // The state change itself still happens.
      await waitFor(() =>
        expect(fileSetFavorite).toHaveBeenCalledWith(1, "ws", true),
      );
    } finally {
      window.matchMedia = orig;
    }
  });

  it("is a native button, so keyboard activation shares the click path (FR-012)", () => {
    setup(0);
    const btn = screen.getByRole("button");
    expect(btn.tagName).toBe("BUTTON");

    // Keyboard Enter/Space on a native button runs the element's activation
    // behavior, dispatching the same click event simulated here.
    fireEvent.click(btn);

    expect(burst().length).toBe(1);
  });
});
