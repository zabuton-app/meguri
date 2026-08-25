// The Watch Later toggle on a Discovery slide: it reflects the shared membership
// passed down by the route, and activating it hits the same collection IPC the
// list views use. The mutation itself is covered by WatchLaterButton's own tests.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useI18n } from "@/i18n/I18nProvider";
import type { FileRow } from "@/ipc/types";
import type { WatchLaterMembership } from "@/hooks/useWatchLater";

const mocks = vi.hoisted(() => ({
  collectionAddFile: vi.fn(),
  collectionRemoveFile: vi.fn(),
  openExternal: vi.fn(),
  fileSetFavorite: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    collectionAddFile: (...args: unknown[]): Promise<void> =>
      mocks.collectionAddFile(...args) as Promise<void>,
    collectionRemoveFile: (...args: unknown[]): Promise<void> =>
      mocks.collectionRemoveFile(...args) as Promise<void>,
    openExternal: (...args: unknown[]): Promise<void> =>
      mocks.openExternal(...args) as Promise<void>,
    fileSetFavorite: (...args: unknown[]): Promise<void> =>
      mocks.fileSetFavorite(...args) as Promise<void>,
  },
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
}));

const { DiscoverCard } = await import("../DiscoverCard");

const file: FileRow = {
  id: 7,
  workspaceId: "ws",
  relPath: "clips/sample.mp4",
  kind: "video",
  size: 1024,
  duration: 120,
  width: 1920,
  height: 1080,
  thumbStatus: "none",
  favorite: 0,
  rating: 0,
} as FileRow;

const membership = (included: boolean): WatchLaterMembership => ({
  id: "watch-later",
  has: () => included,
});

function Harness({ included }: { included: boolean }) {
  const { t } = useI18n();
  return (
    <DiscoverCard
      file={file}
      mediaBase=""
      thumbVersion={0}
      onRate={() => {}}
      watchLater={membership(included)}
      isActive={false}
      t={t}
    />
  );
}

/** The Watch Later control is the card's only clock-iconed button. */
function watchLaterButton(): HTMLButtonElement {
  const el = document
    .querySelector("svg.lucide-clock")
    ?.closest("button") as HTMLButtonElement | null;
  if (!el) throw new Error("Watch Later toggle not rendered");
  return el;
}

describe("DiscoverCard watch later", () => {
  beforeEach(() => {
    mocks.collectionAddFile.mockReset().mockResolvedValue(undefined);
    mocks.collectionRemoveFile.mockReset().mockResolvedValue(undefined);
  });

  it("renders the toggle unpressed for a file that is not queued", () => {
    renderWithProviders(<Harness included={false} />);

    expect(watchLaterButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("renders the toggle pressed for a queued file", () => {
    renderWithProviders(<Harness included />);

    expect(watchLaterButton().getAttribute("aria-pressed")).toBe("true");
  });

  it("queues the file through the collection IPC on activation", async () => {
    renderWithProviders(<Harness included={false} />);

    fireEvent.click(watchLaterButton());

    await waitFor(() =>
      expect(mocks.collectionAddFile).toHaveBeenCalledWith(
        "watch-later",
        7,
        "ws",
      ),
    );
    expect(mocks.collectionRemoveFile).not.toHaveBeenCalled();
  });

  it("unqueues an already queued file", async () => {
    renderWithProviders(<Harness included />);

    fireEvent.click(watchLaterButton());

    await waitFor(() =>
      expect(mocks.collectionRemoveFile).toHaveBeenCalledWith(
        "watch-later",
        7,
        "ws",
      ),
    );
    expect(mocks.collectionAddFile).not.toHaveBeenCalled();
  });
});
