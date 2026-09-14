// The Watch Later toggle on a Discovery slide: it reflects the shared membership
// passed down by the route, and activating it hits the same collection IPC the
// list views use. The mutation itself is covered by WatchLaterButton's own tests.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useI18n } from "@/i18n/I18nProvider";
import type { FileRow } from "@/ipc/types";
import type { WatchLaterMembership } from "@/hooks/useWatchLater";

const mocks = vi.hoisted(() => ({
  collectionAddFile: vi.fn(),
  collectionRemoveFile: vi.fn(),
  openExternal: vi.fn(),
  fileSetFavorite: vi.fn(),
  fileRecordPlay: vi.fn(),
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
    fileRecordPlay: (...args: unknown[]): Promise<void> =>
      mocks.fileRecordPlay(...args) as Promise<void>,
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

describe("DiscoverCard non-audio", () => {
  it("has no spectrum toggle for a video", () => {
    function Harness() {
      const { t } = useI18n();
      return (
        <DiscoverCard
          file={{ ...file, kind: "video" }}
          mediaBase=""
          thumbVersion={0}
          onRate={() => {}}
          watchLater={membership(false)}
          isActive={false}
          t={t}
        />
      );
    }
    renderWithProviders(<Harness />);
    expect(screen.queryByRole("button", { name: /spectrum/i })).toBeNull();
    expect(screen.queryByTestId("audio-spectrum")).toBeNull();
  });
});

describe("DiscoverCard thumbnail fallback", () => {
  function renderCard(overrides: Partial<FileRow>) {
    function Harness() {
      const { t } = useI18n();
      return (
        <DiscoverCard
          file={{ ...file, ...overrides }}
          mediaBase="http://127.0.0.1:1"
          thumbVersion={0}
          onRate={() => {}}
          watchLater={membership(false)}
          isActive={false}
          t={t}
        />
      );
    }
    return renderWithProviders(<Harness />);
  }

  it("falls back to the kind icon when a recorded thumbnail fails to load", () => {
    // hasThumb is 1 but the file behind it is gone (stale row, deleted thumbs
    // dir). Without an onError handler the slide would show broken artwork.
    const { container } = renderCard({
      kind: "audio",
      thumbStatus: "done",
      hasThumb: 1,
    });
    const img = container.querySelector(`img[alt="${file.relPath}"]`);
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg.lucide-music")).not.toBeNull();
  });

  it("retries a thumbnail whose URL changed after a failure", () => {
    // Keyed on the failed URL, not a sticky flag: a thumb:done bump produces a
    // new ?v= and deserves a fresh attempt.
    const { container, rerender } = renderCard({
      thumbStatus: "done",
      hasThumb: 1,
    });
    fireEvent.error(container.querySelector(`img[alt="${file.relPath}"]`)!);
    expect(container.querySelector("img")).toBeNull();
    function Bumped() {
      const { t } = useI18n();
      return (
        <DiscoverCard
          file={{ ...file, thumbStatus: "done", hasThumb: 1 }}
          mediaBase="http://127.0.0.1:1"
          thumbVersion={1}
          onRate={() => {}}
          watchLater={membership(false)}
          isActive={false}
          t={t}
        />
      );
    }
    rerender(<Bumped />);
    expect(container.querySelector("img")).not.toBeNull();
  });
});

describe("DiscoverCard audio", () => {
  function renderAudio() {
    function Harness() {
      const { t } = useI18n();
      return (
        <DiscoverCard
          file={{ ...file, kind: "audio", relPath: "music/track.mp3" }}
          mediaBase=""
          thumbVersion={0}
          onRate={() => {}}
          watchLater={membership(false)}
          isActive={false}
          t={t}
        />
      );
    }
    return renderWithProviders(<Harness />);
  }

  it("offers Play as a button that stays in Discover, not a link to the detail view", () => {
    renderAudio();
    const plays = screen.getAllByRole("button", { name: /^play$/i });
    // The centre affordance and the primary action, both buttons.
    expect(plays).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /^play$/i })).toBeNull();
  });

  it("carries the spectrum toggle, which hides and shows the display", () => {
    vi.stubGlobal("AudioContext", undefined);
    renderAudio();
    expect(screen.queryByTestId("audio-spectrum")).not.toBeNull();
    const toggle = screen.getByRole("button", { name: "Hide spectrum" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.queryByTestId("audio-spectrum")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Show spectrum" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    vi.unstubAllGlobals();
  });

  it("opens the detail view without autoplay when the card itself is clicked", () => {
    const { container } = renderAudio();
    const card = container.querySelector('a[href*="/file/"]');
    expect(card?.getAttribute("href")).toContain("autoplay=0");
  });

  it("flips Play to Pause once its track is playing, and hosts no transport", () => {
    // Discover stays a browsing surface: the slide only reflects whether its
    // own track is the one playing. Seeking and volume wait for the bar.
    mocks.fileRecordPlay.mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    let el: HTMLAudioElement | undefined;
    const capture = (instance: HTMLAudioElement) => {
      el = instance;
    };
    const OriginalAudio = window.Audio;
    vi.stubGlobal(
      "Audio",
      class extends OriginalAudio {
        constructor() {
          super();
          capture(this);
        }
      },
    );
    renderAudio();
    fireEvent.click(screen.getAllByRole("button", { name: /^play$/i })[0]);
    act(() => {
      el?.dispatchEvent(new Event("play"));
    });
    const pauses = screen.getAllByRole("button", { name: /^pause$/i });
    expect(pauses).toHaveLength(2);
    for (const b of pauses) expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("slider", { name: /seek/i })).toBeNull();
    expect(screen.queryByRole("region", { name: /audio player/i })).toBeNull();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
