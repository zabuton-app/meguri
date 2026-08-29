import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { MediaNavProvider, type MediaNav } from "@/components/MediaNavContext";
import Player from "@/routes/Player";
import type { FileDetail, FileRow } from "@/ipc/types";
import {
  defaultAppStatus,
  sampleFileDetail,
  sampleFileRow,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn(),
  fileGet: vi.fn(),
  fileRecordPlay: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    fileGet: (id: number, ws: string) => mocks.fileGet(id, ws),
    fileRecordPlay: (...args: unknown[]) => mocks.fileRecordPlay(...args),
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
  events: {},
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
  collectionTarget: (id: string) => `collection:${id}`,
}));

function row(id: number, kind: "video" | "image"): FileRow {
  return {
    ...sampleFileRow,
    id,
    kind,
    relPath:
      kind === "image" ? `photos/pic-${id}.jpg` : `videos/clip-${id}.mp4`,
  };
}

function detailFor(id: number, kind: "video" | "image"): FileDetail {
  return { ...sampleFileDetail, ...row(id, kind) };
}

function nav(items: FileRow[], overrides: Partial<MediaNav> = {}): MediaNav {
  return {
    items,
    listOffset: 0,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchPreviousPage: vi.fn(),
    hasPreviousPage: false,
    isFetchingPreviousPage: false,
    ...overrides,
  };
}

function renderPlayer(items: FileRow[], overrides?: Partial<MediaNav>) {
  return renderWithProviders(
    <MediaNavProvider value={nav(items, overrides)}>
      <Player />
    </MediaNavProvider>,
    { route: "/play" },
  );
}

/** Seed the persisted preferences the player reads on mount. */
function setPrefs(prefs: Record<string, unknown>) {
  localStorage.setItem("meguri.prefs", JSON.stringify(prefs));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.appStatus.mockResolvedValue(defaultAppStatus);
  mocks.fileGet.mockImplementation((id: number) =>
    Promise.resolve(detailFor(id, id % 2 === 0 ? "image" : "video")),
  );
  mocks.fileRecordPlay.mockResolvedValue(undefined);
});

describe("Player chrome", () => {
  it("shows playback controls and the one way out to the detail view", async () => {
    renderPlayer([row(1, "video"), row(2, "image")]);
    await screen.findByLabelText("Play (Space)");
    expect(screen.getByLabelText("Next (N)")).toBeTruthy();
    expect(screen.getByLabelText("Previous (P)")).toBeTruthy();
    expect(screen.getByLabelText("Shuffle (S)")).toBeTruthy();
    expect(screen.getByLabelText("Repeat")).toBeTruthy();
    expect(screen.getByLabelText("Exit playback (Esc)")).toBeTruthy();
    expect(screen.getByLabelText("Open details (I)")).toBeTruthy();
  });

  it("shows no manual-browsing affordances beyond the detail button (FR-022)", async () => {
    renderPlayer([row(1, "video"), row(2, "image")]);
    await screen.findByLabelText("Play (Space)");
    // The detail button is the single exception, and it is a button that parks
    // the pass on its way out — not a bare link that would strand playback.
    expect(document.querySelectorAll("a")).toHaveLength(0);
    // No favorite / rating / tag editing, no scene rail, no open-externally.
    for (const label of [
      "Add to favorites",
      "Remove from favorites",
      "Open in external player",
      "Save current frame as an image",
    ]) {
      expect(screen.queryByLabelText(label)).toBeNull();
      expect(screen.queryByTitle(label)).toBeNull();
    }
  });

  it("names the current file, and only by its file name", async () => {
    renderPlayer([row(1, "video")]);
    expect(await screen.findByText("clip-1.mp4")).toBeTruthy();
  });

  it("reports progress through the queue", async () => {
    renderPlayer([row(1, "video"), row(2, "image"), row(3, "video")]);
    expect(await screen.findByText("1 / 3")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next (N)"));
    expect(await screen.findByText("2 / 3")).toBeTruthy();
  });

  it("disables Previous until something has played", async () => {
    renderPlayer([row(1, "video"), row(2, "image")]);
    const prev = await screen.findByLabelText("Previous (P)");
    expect(prev).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText("Next (N)"));
    await waitFor(() => {
      expect(screen.getByLabelText("Previous (P)")).toHaveProperty(
        "disabled",
        false,
      );
    });
  });
});

describe("Player keyboard control", () => {
  it("wakes the control bar on a shortcut, so a keypress has an answer", async () => {
    // Shortcuts are handled on window; the root's own onKeyDown never sees them
    // because focus sits on <body>, so nothing used to bring the bar back.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPlayer([row(1, "video"), row(3, "video")]);
      await screen.findByLabelText("Next (N)");
      const chrome = () =>
        document.querySelector('[data-slot="player-chrome"]');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(chrome()?.className).toContain("opacity-0");
      fireEvent.keyDown(window, { code: "KeyS" });
      expect(chrome()?.className).toContain("opacity-100");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts the countdown when a control is pressed", async () => {
    // The bar used to keep counting from the last mouse *movement*, so pressing
    // Next and then holding still made it vanish moments later.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPlayer([row(1, "video"), row(3, "video")]);
      const nextButton = await screen.findByLabelText("Next (N)");
      const chrome = () =>
        document.querySelector('[data-slot="player-chrome"]');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      fireEvent.pointerDown(nextButton);
      // Past the point the original countdown would have expired.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(chrome()?.className).toContain("opacity-100");
      // And it still goes away once the new countdown runs out.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      expect(chrome()?.className).toContain("opacity-0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("steps forward on N and back on P", async () => {
    renderPlayer([row(1, "video"), row(3, "video"), row(5, "video")]);
    await screen.findByText("1 / 3");
    fireEvent.keyDown(window, { code: "KeyN" });
    expect(await screen.findByText("2 / 3")).toBeTruthy();
    fireEvent.keyDown(window, { code: "KeyP" });
    expect(await screen.findByText("1 / 3")).toBeTruthy();
  });

  it("steps with the arrow keys while an image is on screen", async () => {
    renderPlayer([row(2, "image"), row(4, "image")]);
    await screen.findByText("1 / 2");
    fireEvent.keyDown(window, { code: "ArrowRight" });
    expect(await screen.findByText("2 / 2")).toBeTruthy();
    fireEvent.keyDown(window, { code: "ArrowLeft" });
    expect(await screen.findByText("1 / 2")).toBeTruthy();
  });

  it("toggles pause on Space for images", async () => {
    renderPlayer([row(2, "image")]);
    await screen.findByLabelText("Pause (Space)");
    fireEvent.keyDown(window, { code: "KeyS" });
    fireEvent.keyDown(window, { code: "Space" });
    expect(await screen.findByLabelText("Play (Space)")).toBeTruthy();
  });

  it("toggles shuffle on S and persists the choice", async () => {
    renderPlayer([row(1, "video"), row(3, "video")]);
    const shuffle = await screen.findByLabelText("Shuffle (S)");
    expect(shuffle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(window, { code: "KeyS" });
    await waitFor(() => {
      expect(
        screen.getByLabelText("Shuffle (S)").getAttribute("aria-pressed"),
      ).toBe("true");
    });
    expect(localStorage.getItem("meguri.prefs")).toContain(
      '"playlistShuffle":true',
    );
  });

  it("ignores keys while a text field has focus", async () => {
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(window, { code: "KeyN" });
    expect(await screen.findByText("1 / 2")).toBeTruthy();
    input.remove();
  });
});

describe("Player video chrome", () => {
  /** Let the <video> report itself as loaded, which is what reveals its chrome. */
  function loadVideo() {
    const video = document.querySelector("video");
    expect(video).not.toBeNull();
    fireEvent.loadedMetadata(video!);
  }

  it("never shows the video's own controls on top of the player's", async () => {
    renderPlayer([row(1, "video")]);
    await screen.findByText("clip-1.mp4");
    loadVideo();
    // Paused (jsdom never actually plays), which is exactly when the video
    // player would otherwise raise its centre play button and control bar.
    expect(screen.queryByTitle("Play")).toBeNull();
    expect(screen.queryByTitle("Seek")).toBeNull();
    // The player's own bar carries the volume control; the video must not add
    // a second one behind it.
    expect(screen.getAllByTitle("Volume")).toHaveLength(1);
    // The player has a fullscreen control of its own; the video must not add a
    // second one behind it.
    expect(screen.getAllByTitle("Fullscreen (F)")).toHaveLength(1);
    expect(screen.getByLabelText("Fullscreen (F)")).toBeTruthy();
  });

  it("hands the video the whole stage instead of boxing it to its ratio", async () => {
    // The detail view's aspect-ratio box and 78vh cap leave room for metadata
    // below; in the player they only show up as bands above and below the video.
    renderPlayer([row(1, "video")]);
    await screen.findByText("clip-1.mp4");
    const video = document.querySelector("video");
    const stage = video?.parentElement;
    expect(stage?.style.aspectRatio).toBeFalsy();
    expect(stage?.className).not.toContain("max-h-[78vh]");
    expect(video?.className).not.toContain("max-h-[78vh]");
  });

  it("lets the blurred backdrop show through the letterbox bars", async () => {
    // The stage paints a blurred cover of the same file behind the media; an
    // opaque video wrapper would hide it and leave flat black bars instead.
    renderPlayer([row(1, "video")]);
    await screen.findByText("clip-1.mp4");
    const stage = document.querySelector("video")?.parentElement;
    expect(stage?.className).not.toContain("bg-black");
  });

  it("grounds the stage in black under a dark appearance", async () => {
    localStorage.setItem("meguri.theme", "gruvbox-dark");
    renderPlayer([row(1, "video")]);
    await screen.findByText("clip-1.mp4");
    expect(document.querySelectorAll(".bg-white")).toHaveLength(0);
    expect(document.querySelectorAll(".bg-black").length).toBeGreaterThan(0);
  });

  it("grounds the stage in white under a light appearance", async () => {
    // A transparent image is composited straight onto the ground, so a fixed
    // black would swallow light artwork for anyone working in a light theme.
    localStorage.setItem("meguri.theme", "gruvbox-light");
    renderPlayer([row(1, "video")]);
    await screen.findByText("clip-1.mp4");
    expect(document.querySelectorAll(".bg-black")).toHaveLength(0);
    expect(document.querySelectorAll(".bg-white").length).toBeGreaterThan(0);
  });

  it("keeps the video's controls hidden after a play/pause keypress", async () => {
    // "K" is the video player's own play/pause chord; it used to surface the
    // chrome the playlist player deliberately replaces.
    renderPlayer([row(1, "video")]);
    await screen.findByText("clip-1.mp4");
    loadVideo();
    fireEvent.keyDown(window, { code: "KeyK" });
    expect(screen.queryByTitle("Play")).toBeNull();
    expect(screen.getAllByTitle("Volume")).toHaveLength(1);
  });
});

describe("Player fullscreen", () => {
  it("does not take over the screen on its own", async () => {
    const request = vi.fn();
    Element.prototype.requestFullscreen = request;
    renderPlayer([row(1, "video")]);
    await screen.findByText("clip-1.mp4");
    expect(request).not.toHaveBeenCalled();
  });

  it("offers full screen as a control instead", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    Element.prototype.requestFullscreen = request;
    renderPlayer([row(1, "video")]);
    fireEvent.click(await screen.findByLabelText("Fullscreen (F)"));
    expect(request).toHaveBeenCalled();
  });

  it("toggles full screen on F", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    Element.prototype.requestFullscreen = request;
    renderPlayer([row(1, "video")]);
    await screen.findByText("clip-1.mp4");
    fireEvent.keyDown(window, { code: "KeyF" });
    expect(request).toHaveBeenCalled();
  });

  it("keeps playing when full screen is left", async () => {
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    // Whatever route the user took out of full screen, the queue is untouched.
    fireEvent(document, new Event("fullscreenchange"));
    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(screen.getByLabelText("Next (N)")).toBeTruthy();
  });
});

describe("Player paging keys", () => {
  it("steps with the preset's paging chords", async () => {
    // Default "normal" preset: [ and ] page between files elsewhere in the app.
    renderPlayer([row(1, "video"), row(3, "video"), row(5, "video")]);
    await screen.findByText("1 / 3");
    fireEvent.keyDown(window, { code: "BracketRight" });
    expect(await screen.findByText("2 / 3")).toBeTruthy();
    fireEvent.keyDown(window, { code: "BracketLeft" });
    expect(await screen.findByText("1 / 3")).toBeTruthy();
  });

  it("follows the configured preset rather than a fixed pair of keys", async () => {
    setPrefs({ keybindingPreset: "vim" });
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    fireEvent.keyDown(window, { code: "KeyL" });
    expect(await screen.findByText("2 / 2")).toBeTruthy();
    fireEvent.keyDown(window, { code: "KeyH" });
    expect(await screen.findByText("1 / 2")).toBeTruthy();
  });

  it("leaves the normal preset's chords inert under another preset", async () => {
    setPrefs({ keybindingPreset: "vim" });
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    fireEvent.keyDown(window, { code: "BracketRight" });
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });
});

describe("Player switching latency", () => {
  it("renders the media without waiting for its details", async () => {
    // file_get used to gate the whole stage, putting an IPC round trip between
    // the swap and the first pixel.
    let resolveDetail: (d: FileDetail) => void = () => {};
    mocks.fileGet.mockImplementation(
      () =>
        new Promise<FileDetail>((resolve) => {
          resolveDetail = resolve;
        }),
    );
    renderPlayer([row(1, "video")]);
    // Nothing has answered file_get yet, and the video is already streaming.
    await waitFor(() => {
      expect(
        document.querySelector("video")?.getAttribute("src") ?? "",
      ).toContain("/media/1");
    });
    expect(screen.queryByText("clip-1.mp4")).toBeNull();
    resolveDetail(detailFor(1, "video"));
    // The detail only fills in the label afterwards.
    expect(await screen.findByText("clip-1.mp4")).toBeTruthy();
  });

  it("warms the next item before it is reached", async () => {
    const requested: string[] = [];
    class SpyImage {
      set src(value: string) {
        requested.push(value);
      }
    }
    const original = globalThis.Image;
    globalThis.Image = SpyImage as unknown as typeof Image;
    try {
      renderPlayer([row(1, "video"), row(2, "image")]);
      await screen.findByText("clip-1.mp4");
      // The upcoming image is decoded ahead of the swap; a video only needs the
      // thumbnail its blurred backdrop is drawn from.
      await waitFor(() => {
        expect(requested.some((u) => u.includes("/media/2"))).toBe(true);
      });
    } finally {
      globalThis.Image = original;
    }
  });
});

describe("Player transitions", () => {
  function live(): HTMLElement | null {
    return document.querySelector('[data-slot="player-fade"]');
  }
  function outgoing(): HTMLElement | null {
    return document.querySelector('[data-slot="player-leaving"]');
  }

  it("swaps at once so the incoming item is on screen for the whole switch", async () => {
    // The item changes immediately; the one that left is held beside it as a
    // still rather than the stage going empty between the two.
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });

  it("holds no outgoing layer when there was no frame to freeze", async () => {
    // jsdom paints nothing, so there is nothing to capture — and a switch with
    // no still to animate against is a plain swap, not an empty stage.
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    expect(outgoing()).toBeNull();
    expect(live()?.style.opacity).toBeFalsy();
  });

  it("still moves two items when next is pressed twice in quick succession", async () => {
    renderPlayer([row(1, "video"), row(3, "video"), row(5, "video")]);
    await screen.findByText("1 / 3");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    fireEvent.click(screen.getByLabelText("Next (N)"));
    expect(await screen.findByText("3 / 3")).toBeTruthy();
  });

  it("swaps instantly when the OS asks for reduced motion", async () => {
    const original = window.matchMedia;
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
    try {
      renderPlayer([row(1, "video"), row(3, "video")]);
      await screen.findByText("1 / 2");
      fireEvent.click(screen.getByLabelText("Next (N)"));
      expect(screen.getByText("2 / 2")).toBeTruthy();
      expect(outgoing()).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("Player empty state", () => {
  it("explains that there is nothing to play instead of showing a blank screen", async () => {
    renderPlayer([]);
    expect(await screen.findByText("Nothing here can be played.")).toBeTruthy();
    expect(screen.queryByLabelText("Play (Space)")).toBeNull();
  });
});

describe("Player play recording", () => {
  it("records a play for images, which is what drops them from Watch Later", async () => {
    renderPlayer([row(2, "image")]);
    await waitFor(() => {
      expect(mocks.fileRecordPlay).toHaveBeenCalledWith(2, WS_ID, "browser");
    });
  });
});
