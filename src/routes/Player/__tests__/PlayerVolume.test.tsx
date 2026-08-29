import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { MediaNavProvider, type MediaNav } from "@/components/MediaNavContext";
import Player from "@/routes/Player";
import { setVolume } from "@/hooks/useVolume";
import type { FileDetail, FileRow } from "@/ipc/types";
import {
  defaultAppStatus,
  sampleFileDetail,
  sampleFileRow,
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

const slider = () => screen.getByTitle<HTMLInputElement>("Volume");
const video = () => document.querySelector("video") as HTMLVideoElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // The store is module state, so each test starts from a known level rather
  // than inheriting the previous one.
  setVolume(1);
  mocks.appStatus.mockResolvedValue(defaultAppStatus);
  mocks.fileGet.mockImplementation((id: number) =>
    Promise.resolve(detailFor(id, id % 2 === 0 ? "image" : "video")),
  );
  mocks.fileRecordPlay.mockResolvedValue(undefined);
});

describe("Player volume control (US1)", () => {
  it("puts a volume control on the player's own bar", async () => {
    renderPlayer([row(1, "video")]);
    await screen.findByLabelText("Play (Space)");
    expect(slider()).toBeTruthy();
    expect(screen.getByLabelText("Mute (M)")).toBeTruthy();
  });

  it("moves the media element's volume without touching playback", async () => {
    renderPlayer([row(1, "video")]);
    await screen.findByLabelText("Play (Space)");
    const el = video();
    el.currentTime = 12;
    fireEvent.change(slider(), { target: { value: "0.4" } });
    await waitFor(() => expect(el.volume).toBeCloseTo(0.4));
    expect(el.currentTime).toBe(12);
    expect(el.paused).toBe(true);
  });

  it("shows silence as silence once the slider bottoms out", async () => {
    renderPlayer([row(1, "video")]);
    await screen.findByLabelText("Play (Space)");
    fireEvent.change(slider(), { target: { value: "0" } });
    await waitFor(() => expect(video().volume).toBe(0));
    // Zero volume and mute look the same to the listener, so they look the
    // same on the bar too.
    expect(
      screen
        .getByLabelText("Mute (M)")
        .querySelector("svg")
        ?.getAttribute("class"),
    ).toContain("volume-x");
    expect(slider().value).toBe("0");
  });
});

describe("Player mute (US2)", () => {
  it("returns to the same level after a mute round trip", async () => {
    renderPlayer([row(1, "video")]);
    await screen.findByLabelText("Play (Space)");
    fireEvent.change(slider(), { target: { value: "0.5" } });
    await waitFor(() => expect(video().volume).toBeCloseTo(0.5));

    fireEvent.click(screen.getByLabelText("Mute (M)"));
    const unmute = await screen.findByLabelText("Unmute (M)");
    expect(video().muted).toBe(true);
    // The level is held, not zeroed, so unmuting can restore it exactly.
    expect(video().volume).toBeCloseTo(0.5);
    expect(slider().value).toBe("0");

    fireEvent.click(unmute);
    await screen.findByLabelText("Mute (M)");
    expect(video().muted).toBe(false);
    expect(video().volume).toBeCloseTo(0.5);
    expect(Number(slider().value)).toBeCloseTo(0.5);
  });

  it("leaves mute behind when the slider is moved", async () => {
    renderPlayer([row(1, "video")]);
    await screen.findByLabelText("Play (Space)");
    fireEvent.click(screen.getByLabelText("Mute (M)"));
    await screen.findByLabelText("Unmute (M)");
    fireEvent.change(slider(), { target: { value: "0.8" } });
    await screen.findByLabelText("Mute (M)");
    await waitFor(() => expect(video().muted).toBe(false));
    expect(video().volume).toBeCloseTo(0.8);
  });
});

describe("Player volume keyboard (US3)", () => {
  it("steps once per press while a video is on screen", async () => {
    // Both the player and the video player listen on window; if both acted the
    // level would move twice per press.
    renderPlayer([row(1, "video")]);
    await screen.findByLabelText("Play (Space)");
    fireEvent.change(slider(), { target: { value: "0.5" } });
    await waitFor(() => expect(video().volume).toBeCloseTo(0.5));
    fireEvent.keyDown(window, { code: "ArrowDown" });
    await waitFor(() => expect(video().volume).toBeCloseTo(0.45));
    fireEvent.keyDown(window, { code: "ArrowUp" });
    await waitFor(() => expect(video().volume).toBeCloseTo(0.5));
  });

  it("still works while an image is on screen", async () => {
    // No media element is mounted here, so the player has to handle the keys
    // itself — and the level has to survive until the next video.
    renderPlayer([row(2, "image")]);
    await screen.findByLabelText("Pause (Space)");
    fireEvent.keyDown(window, { code: "ArrowDown" });
    await waitFor(() => expect(Number(slider().value)).toBeCloseTo(0.95));
    fireEvent.keyDown(window, { code: "KeyM" });
    expect(await screen.findByLabelText("Unmute (M)")).toBeTruthy();
    expect(slider().value).toBe("0");
  });

  it("stops at the ends of the range", async () => {
    renderPlayer([row(2, "image")]);
    await screen.findByLabelText("Pause (Space)");
    for (let i = 0; i < 5; i += 1)
      fireEvent.keyDown(window, { code: "ArrowUp" });
    // Read the stored value, not the slider: an <input type="range"> clamps to
    // its own min/max, so it would report a tidy 1 even if the level had run
    // past it.
    expect(localStorage.getItem("meguri.player.volume")).toBe("1");
    for (let i = 0; i < 30; i += 1)
      fireEvent.keyDown(window, { code: "ArrowDown" });
    expect(localStorage.getItem("meguri.player.volume")).toBe("0");
  });

  it("turns the level down without breaking the silence", async () => {
    renderPlayer([row(2, "image")]);
    await screen.findByLabelText("Pause (Space)");
    fireEvent.keyDown(window, { code: "KeyM" });
    await screen.findByLabelText("Unmute (M)");
    fireEvent.keyDown(window, { code: "ArrowDown" });
    // Still muted: turning it down is not a request to start hearing it.
    expect(screen.getByLabelText("Unmute (M)")).toBeTruthy();
    expect(localStorage.getItem("meguri.player.volume")).toBe("0.95");
  });

  it("wakes the control bar so a volume keypress has an answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPlayer([row(1, "video")]);
      await screen.findByLabelText("Play (Space)");
      const chrome = () =>
        document.querySelector('[data-slot="player-chrome"]');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(chrome()?.className).toContain("opacity-0");
      fireEvent.keyDown(window, { code: "ArrowDown" });
      await waitFor(() => expect(chrome()?.className).toContain("opacity-100"));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Player volume persistence (US4)", () => {
  it("carries the level into the next item", async () => {
    renderPlayer([row(1, "video"), row(3, "video")]);
    await screen.findByText("1 / 2");
    fireEvent.change(slider(), { target: { value: "0.3" } });
    await waitFor(() => expect(video().volume).toBeCloseTo(0.3));
    fireEvent.click(screen.getByLabelText("Next (N)"));
    await screen.findByText("2 / 2");
    // A fresh element for the next file, which must not start at full blast.
    await waitFor(() => expect(video().volume).toBeCloseTo(0.3));
    expect(Number(slider().value)).toBeCloseTo(0.3);
  });

  it("writes the level and mute out for the next session", async () => {
    renderPlayer([row(1, "video")]);
    await screen.findByLabelText("Play (Space)");
    fireEvent.change(slider(), { target: { value: "0.25" } });
    await waitFor(() =>
      expect(localStorage.getItem("meguri.player.volume")).toBe("0.25"),
    );
    fireEvent.click(screen.getByLabelText("Mute (M)"));
    await waitFor(() =>
      expect(localStorage.getItem("meguri.player.muted")).toBe("1"),
    );
    expect(localStorage.getItem("meguri.player.volume")).toBe("0.25");
  });
});

describe("Player volume on silent items", () => {
  const volumeGroup = () => slider().parentElement;

  it("keeps the control in place and usable while an image is shown", async () => {
    renderPlayer([row(1, "video"), row(2, "image"), row(3, "video")]);
    await screen.findByText("1 / 3");
    expect(volumeGroup()?.className).not.toContain("opacity-50");
    const buttonsWithSound = document.querySelectorAll("button").length;

    fireEvent.click(screen.getByLabelText("Next (N)"));
    await screen.findByText("2 / 3");
    // Still drawn and still operable — removing it would shift every button
    // beside it, and disabling it would contradict the keys, which do work
    // here. Dimming is what says "nothing to hear right now".
    expect(volumeGroup()?.className).toContain("opacity-50");
    expect(slider()).toHaveProperty("disabled", false);
    expect(screen.getByLabelText("Mute (M)")).toHaveProperty("disabled", false);
    expect(document.querySelectorAll("button")).toHaveLength(buttonsWithSound);

    // What is set during the picture is what the next video plays at.
    fireEvent.change(slider(), { target: { value: "0.35" } });
    fireEvent.click(screen.getByLabelText("Next (N)"));
    await screen.findByText("3 / 3");
    expect(volumeGroup()?.className).not.toContain("opacity-50");
    await waitFor(() => expect(video().volume).toBeCloseTo(0.35));
  });
});
