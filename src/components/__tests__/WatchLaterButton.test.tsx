// Spec-009 effect animation on the Watch Later toggle: burst on queue / settle
// on unqueue, fired only by direct activation of this control instance (never by
// membership changes coming from another view), restarted cleanly on rapid
// re-activation and suppressed under prefers-reduced-motion.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { WatchLaterMembership } from "@/hooks/useWatchLater";

const mocks = vi.hoisted(() => ({
  collectionAddFile: vi.fn(),
  collectionRemoveFile: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    collectionAddFile: (...args: unknown[]): Promise<void> =>
      mocks.collectionAddFile(...args) as Promise<void>,
    collectionRemoveFile: (...args: unknown[]): Promise<void> =>
      mocks.collectionRemoveFile(...args) as Promise<void>,
  },
  ALL_ID: "__all__",
}));

const { WatchLaterButton } = await import("@/components/WatchLaterButton");

const membership = (included: boolean): WatchLaterMembership => ({
  id: "watch-later",
  has: () => included,
});

function setup(included: boolean) {
  const view = renderWithProviders(
    <WatchLaterButton
      fileId={1}
      workspaceId="ws"
      watchLater={membership(included)}
    />,
  );
  const rerenderWith = (next: boolean) =>
    view.rerender(
      <WatchLaterButton
        fileId={1}
        workspaceId="ws"
        watchLater={membership(next)}
      />,
    );
  return { rerenderWith };
}

const burst = () => document.querySelectorAll('[data-testid="fx-burst"]');
const popWrapper = () => document.querySelectorAll(".fx-pop");
const settleWrapper = () => document.querySelectorAll(".fx-settle");

describe("WatchLaterButton", () => {
  beforeEach(() => {
    mocks.collectionAddFile.mockReset().mockResolvedValue(undefined);
    mocks.collectionRemoveFile.mockReset().mockResolvedValue(undefined);
  });

  it("plays the celebratory burst + pop when queueing a file", async () => {
    setup(false);
    expect(burst().length).toBe(0);

    fireEvent.click(screen.getByRole("button"));

    expect(popWrapper().length).toBe(1);
    expect(burst().length).toBe(1);
    expect(settleWrapper().length).toBe(0);
    await waitFor(() =>
      expect(mocks.collectionAddFile).toHaveBeenCalledWith(
        "watch-later",
        1,
        "ws",
      ),
    );
  });

  it("plays the subtler settle (no particles) when unqueueing a file", async () => {
    setup(true);

    fireEvent.click(screen.getByRole("button"));

    expect(settleWrapper().length).toBe(1);
    expect(burst().length).toBe(0);
    expect(popWrapper().length).toBe(0);
    await waitFor(() =>
      expect(mocks.collectionRemoveFile).toHaveBeenCalledWith(
        "watch-later",
        1,
        "ws",
      ),
    );
  });

  it("restarts cleanly on rapid re-activation: never more than one overlay", async () => {
    setup(false);
    const btn = screen.getByRole("button");

    fireEvent.click(btn);
    // Wait out the pending mutation (the button is disabled while in flight).
    await waitFor(() =>
      expect((btn as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(btn);

    expect(popWrapper().length).toBe(1);
    expect(settleWrapper().length).toBe(0);
    expect(burst().length).toBe(1);
    expect(document.querySelectorAll("svg.lucide-clock").length).toBe(1);
  });

  it("never fires the effect from membership changes made in another view", () => {
    const { rerenderWith } = setup(false);

    rerenderWith(true);

    expect(burst().length).toBe(0);
    expect(popWrapper().length).toBe(0);
    expect(settleWrapper().length).toBe(0);
  });

  it("suppresses all decorative effects under prefers-reduced-motion while still mutating", async () => {
    const orig = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList;
    try {
      setup(false);

      fireEvent.click(screen.getByRole("button"));

      expect(burst().length).toBe(0);
      expect(popWrapper().length).toBe(0);
      expect(settleWrapper().length).toBe(0);
      // The state change itself still happens.
      await waitFor(() =>
        expect(mocks.collectionAddFile).toHaveBeenCalledWith(
          "watch-later",
          1,
          "ws",
        ),
      );
    } finally {
      window.matchMedia = orig;
    }
  });
});
