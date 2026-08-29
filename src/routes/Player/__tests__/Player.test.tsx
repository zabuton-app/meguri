import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
  it("shows only playback controls", async () => {
    renderPlayer([row(1, "video"), row(2, "image")]);
    await screen.findByLabelText("Play (Space)");
    expect(screen.getByLabelText("Next (N)")).toBeTruthy();
    expect(screen.getByLabelText("Previous (P)")).toBeTruthy();
    expect(screen.getByLabelText("Shuffle (S)")).toBeTruthy();
    expect(screen.getByLabelText("Repeat")).toBeTruthy();
    expect(screen.getByLabelText("Exit playback (Esc)")).toBeTruthy();
  });

  it("shows none of the manual-browsing affordances (FR-022)", async () => {
    renderPlayer([row(1, "video"), row(2, "image")]);
    await screen.findByLabelText("Play (Space)");
    // No route out to the detail view or an external player.
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

describe("Player transitions", () => {
  function fade(): HTMLElement | null {
    return document.querySelector('[data-slot="player-fade"]');
  }

  it("dips the stage out before swapping, then back in", async () => {
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    expect(fade()?.style.opacity).toBe("1");

    fireEvent.click(screen.getByLabelText("Next (N)"));
    // The swap is deferred to the bottom of the dip, so the old item is still
    // on screen while the stage fades out.
    expect(fade()?.style.opacity).toBe("0");
    expect(screen.getByText("1 / 2")).toBeTruthy();

    expect(await screen.findByText("2 / 2")).toBeTruthy();
    await waitFor(() => {
      expect(fade()?.style.opacity).toBe("1");
    });
  });

  it("gives the switch a duration", async () => {
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    expect(fade()?.style.transition).toMatch(/^opacity \d+ms/);
  });

  it("does not slide while only the fade is on (the default)", async () => {
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    expect(fade()?.style.opacity).toBe("0");
    expect(fade()?.style.transform).toBe("");
    await screen.findByText("2 / 2");
  });

  it("slides without dimming when only the transition is on", async () => {
    setPrefs({ playlistFade: false, playlistTransition: true });
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    expect(fade()?.style.opacity).toBe("1");
    // Leaving goes against the direction of travel.
    expect(fade()?.style.transform).toBe("translateX(-100%)");
    await screen.findByText("2 / 2");
  });

  it("dims and slides when both effects are on", async () => {
    setPrefs({ playlistFade: true, playlistTransition: true });
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    expect(fade()?.style.opacity).toBe("0");
    expect(fade()?.style.transform).toBe("translateX(-100%)");
    await screen.findByText("2 / 2");
  });

  it("slides the other way when stepping back", async () => {
    setPrefs({ playlistTransition: true });
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    await screen.findByText("2 / 2");
    fireEvent.click(screen.getByLabelText("Previous (P)"));
    expect(fade()?.style.transform).toBe("translateX(100%)");
    await screen.findByText("1 / 2");
  });

  it("cuts straight over when both effects are off", async () => {
    setPrefs({ playlistFade: false, playlistTransition: false });
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    // No dip, no deferral.
    expect(screen.getByText("2 / 2")).toBeTruthy();
    expect(fade()?.style.transition).toBe("");
  });

  it("still moves two items when next is pressed twice mid-fade", async () => {
    renderPlayer([row(1, "video"), row(3, "video"), row(5, "video")]);
    await screen.findByText("1 / 3");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    // Second press lands before the first swap has been applied.
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
      // No dip, no deferral: the next item is on screen right away.
      expect(screen.getByText("2 / 2")).toBeTruthy();
      expect(fade()?.style.transition).toBe("");
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
