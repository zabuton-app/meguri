// A queue that failed to load says so, rather than that nothing matched.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import Discover from "@/routes/Discover";
import { defaultAppStatus, defaultWorkspacesList } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  filesRandom: vi.fn<(query: unknown) => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => Promise.resolve(defaultAppStatus),
    workspacesList: () => Promise.resolve(defaultWorkspacesList),
    filesRandom: (query: unknown) => mocks.filesRandom(query),
  },
  events: { onThumbDone: vi.fn().mockReturnValue(() => {}) },
  ALL_ID: "__all__",
}));

describe("Discovery load error", () => {
  beforeEach(() => {
    mocks.filesRandom.mockReset();
  });

  it("shows a load error with a retry instead of the empty queue", async () => {
    mocks.filesRandom.mockRejectedValueOnce(new Error("db locked"));
    mocks.filesRandom.mockResolvedValue([]);
    renderWithProviders(
      <Routes>
        <Route path="/discover" element={<Discover />} />
      </Routes>,
      { route: "/discover" },
    );
    expect(
      await screen.findByText(
        "Could not load media to recommend. Please try again.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("No media to recommend.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No media to recommend.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
