import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import "@/test/mockVirtualizer";
import { MediaGrid } from "@/components/MediaGrid";
import { sampleFileRow, WS_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  fileSetFavorite: vi.fn(),
  fileSetRating: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    fileSetFavorite: (...args: unknown[]) => mocks.fileSetFavorite(...args),
    fileSetRating: (...args: unknown[]) => mocks.fileSetRating(...args),
  },
  ALL_ID: "__all__",
}));

describe("MediaGrid", () => {
  beforeEach(() => {
    mocks.fileSetFavorite.mockResolvedValue(undefined);
    mocks.fileSetRating.mockResolvedValue(undefined);
  });

  it("renders file cards with detail links including workspace id", async () => {
    renderWithProviders(
      <MediaGrid
        items={[sampleFileRow]}
        mediaBase="http://127.0.0.1:17345"
        workspaceId={WS_ID}
        loading={false}
        thumbVersion={{}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("sample.mp4")).toBeTruthy();
    });

    const links = screen.getAllByRole("link");
    const detailLink = links.find((link) =>
      link.getAttribute("href")?.includes(`/file/1?ws=${WS_ID}`),
    );
    expect(detailLink).toBeTruthy();
  });

  it("shows the empty state when there are no items", () => {
    renderWithProviders(
      <MediaGrid
        items={[]}
        mediaBase="http://127.0.0.1:17345"
        workspaceId={WS_ID}
        loading={false}
        thumbVersion={{}}
      />,
    );
    expect(screen.getByText(/No media to display/i)).toBeTruthy();
  });
});
