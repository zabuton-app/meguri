// Discovery opened from a folder names the folder its queue is drawn from.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import Discover from "@/routes/Discover";
import { DISCOVER_FILTER_PARAM } from "@/routes/Discover/utils";
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

function renderAt(filter: object | null) {
  const query = filter
    ? `?${DISCOVER_FILTER_PARAM}=${encodeURIComponent(JSON.stringify(filter))}`
    : "";
  return renderWithProviders(
    <Routes>
      <Route path="/discover" element={<Discover />} />
    </Routes>,
    { route: `/discover${query}` },
  );
}

describe("Discovery from a folder", () => {
  beforeEach(() => {
    mocks.filesRandom.mockReset();
    mocks.filesRandom.mockResolvedValue([]);
  });

  it("draws from the folder and says which one", async () => {
    renderAt({ folder: { path: "Movie/2024", recursive: true } });
    await waitFor(() =>
      expect(mocks.filesRandom).toHaveBeenCalledWith(
        expect.objectContaining({
          folder: { path: "Movie/2024", recursive: true },
        }),
      ),
    );
    const chip = await screen.findByTestId("folder-scope");
    // Named from the workspace down, once its name has loaded.
    await waitFor(() => expect(chip.textContent).toBe("Media / Movie / 2024"));
    expect(chip.getAttribute("aria-label")).toBe(
      "Picking from “Media / Movie / 2024”",
    );
  });

  it("names the workspace for its root folder", async () => {
    renderAt({ folder: { path: "", recursive: true } });
    const chip = await screen.findByTestId("folder-scope");
    await waitFor(() => expect(chip.textContent).toBe("Media"));
  });

  it("names no folder when opened from the whole library", async () => {
    renderAt(null);
    await waitFor(() => expect(mocks.filesRandom).toHaveBeenCalled());
    expect(screen.queryByTestId("folder-scope")).toBeNull();
  });
});
