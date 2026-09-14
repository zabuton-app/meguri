// How the detail view is presented: a modal over the window, or a side peek
// docked to the list area. The choice and the modal size are remembered
// separately, so the view reopens the way it was left and going back from the
// peek lands on the modal size last chosen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { Route, Routes, useNavigate } from "react-router";
import "@/test/mockVirtualizer";
import MediaDetail from "@/routes/MediaDetail";
import { MediaNavProvider } from "@/components/MediaNavContext";
import { useBarSuppressed } from "@/audio/barVisibility";
import { useActivateFile } from "@/audio/useActivateFile";
import { usePeekDocked } from "@/routes/MediaDetail/peekDocked";
import type { FileDetail } from "@/ipc/types";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleAudioRow,
  sampleFileDetail,
  sampleFileRow,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn(),
  workspacesList: vi.fn(),
  fileGet: vi.fn(),
  filesSearch: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: (): Promise<unknown> => mocks.appStatus() as Promise<unknown>,
    workspacesList: (): Promise<unknown> =>
      mocks.workspacesList() as Promise<unknown>,
    fileGet: (id: number, ws: string): Promise<unknown> =>
      mocks.fileGet(id, ws) as Promise<unknown>,
    filesSearch: (query: unknown): Promise<unknown> =>
      mocks.filesSearch(query) as Promise<unknown>,
    fileSetFavorite: vi.fn().mockResolvedValue(undefined),
    fileSetRating: vi.fn().mockResolvedValue(undefined),
    fileRecordPlay: vi.fn().mockResolvedValue(undefined),
    tagsList: vi.fn().mockResolvedValue([]),
    openExternal: vi.fn().mockResolvedValue(undefined),
    openFolder: vi.fn().mockResolvedValue(undefined),
    copyFilePath: vi.fn().mockResolvedValue(undefined),
    bookmarkAdd: vi.fn().mockResolvedValue(null),
    bookmarkRemove: vi.fn().mockResolvedValue(undefined),
    thumbSetOffset: vi.fn().mockResolvedValue({ thumbOffsetSec: null }),
    fileAddTag: vi.fn().mockResolvedValue(undefined),
    fileRemoveTag: vi.fn().mockResolvedValue(undefined),
    fileDeleteFromIndex: vi.fn().mockResolvedValue({ id: 1 }),
    collectionAddFile: vi.fn().mockResolvedValue(undefined),
    collectionRemoveFile: vi.fn().mockResolvedValue(undefined),
  },
  events: {
    onThumbDone: vi.fn().mockResolvedValue(() => {}),
  },
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
  collectionTarget: (id: string) => `collection:${id}`,
}));

const audioDetail: FileDetail = {
  ...sampleFileDetail,
  ...sampleAudioRow,
  absPath: "/media/music/track.mp3",
  codec: "mp3",
  fps: null,
};

/** Reports the flags the detail view raises for the rest of the app: whether
 *  the bottom bar is told to step aside, and whether the peek is docked. */
function BarProbe() {
  const suppressed = useBarSuppressed();
  const docked = usePeekDocked();
  return (
    <>
      <output data-testid="bar-suppressed">{String(suppressed)}</output>
      <output data-testid="peek-docked">{String(docked)}</output>
    </>
  );
}

/** What the bottom bar's title does with the peek open: a detour to the
 *  playing track's detail, marked with where it started from. */
function BarDetour({ to, origin }: { to: string; origin: string }) {
  const navigate = useNavigate();
  // Once: `navigate` changes identity with the location, and the detour
  // must not be taken again after it has been left.
  const taken = useRef(false);
  useEffect(() => {
    if (taken.current) return;
    taken.current = true;
    void navigate(to, { state: { outsideRouter: true, origin } });
  }, [navigate, to, origin]);
  return null;
}

/** A list row's play gesture, the way MediaGrid wires it. */
function ListRow() {
  const { activate } = useActivateFile();
  return <button onClick={() => activate(sampleAudioRow)}>play-audio</button>;
}

function DetailRoute({ detour }: { detour?: { to: string; origin: string } }) {
  return (
    <MediaNavProvider
      value={{
        items: [sampleFileRow, sampleAudioRow],
        listOffset: 0,
        fetchNextPage: () => {},
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchPreviousPage: () => {},
        hasPreviousPage: false,
        isFetchingPreviousPage: false,
      }}
    >
      <BarProbe />
      <ListRow />
      {detour && <BarDetour to={detour.to} origin={detour.origin} />}
      <Routes>
        <Route path="file/:id" element={<MediaDetail />} />
      </Routes>
    </MediaNavProvider>
  );
}

/** Open the detail view at `route`. `rowWidth` sizes the box the peek
 *  measures itself against (the setup stubs every element at 1200px; the
 *  frame's `display: contents` wrapper really measures 0 and is skipped). */
async function openDetail(
  route: string,
  heading = "sample.mp4",
  rowWidth?: number,
) {
  renderWithProviders(<DetailRoute />, { route });
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
  });
  if (rowWidth != null) {
    const wrapper = screen.getByRole("dialog").parentElement!;
    Object.defineProperty(wrapper, "clientWidth", {
      configurable: true,
      get: () => 0,
    });
    Object.defineProperty(wrapper.parentElement!, "clientWidth", {
      configurable: true,
      get: () => rowWidth,
    });
    // The fit ran on docking, before the stubs above; a resize re-fits.
    fireEvent(window, new Event("resize"));
  }
}

const dialog = () => screen.getByRole("dialog");
const barSuppressed = () =>
  screen.getByTestId("bar-suppressed").textContent === "true";
const peekDocked = () =>
  screen.getByTestId("peek-docked").textContent === "true";
const peekInset = () =>
  document.documentElement.style.getPropertyValue("--meguri-peek-inset");

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.appStatus.mockResolvedValue(defaultAppStatus);
  mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
  mocks.fileGet.mockResolvedValue(sampleFileDetail);
  mocks.filesSearch.mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  // jsdom has no pointer capture; the drag handle asks for it.
  if (!Element.prototype.setPointerCapture) {
    Object.defineProperty(Element.prototype, "setPointerCapture", {
      value: () => {},
      configurable: true,
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MediaDetail presentation", () => {
  it("opens as a modal by default and hides the bar", async () => {
    await openDetail(`/file/1?ws=${WS_ID}`);
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(barSuppressed()).toBe(true);
  });

  it("switches to the side peek from the header, keeping the bar, and remembers it", async () => {
    await openDetail(`/file/1?ws=${WS_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Open as side peek" }));
    // A sheet beside the list rather than a modal over it: no backdrop, and
    // the bar below the list area stays put.
    expect(dialog().getAttribute("aria-modal")).toBeNull();
    expect(dialog().dataset.presentation).toBe("peek");
    expect(barSuppressed()).toBe(false);
    // …and Home is told the list is in use beside the sheet.
    expect(peekDocked()).toBe(true);
    expect(localStorage.getItem("meguri.media.detail.presentation")).toBe(
      "peek",
    );
    // The file is still on screen, just re-framed.
    expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
  });

  it("re-frames without remounting the player when switching either way", async () => {
    await openDetail(`/file/1?ws=${WS_ID}`);
    const video = document.querySelector("video");
    expect(video).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open as side peek" }));
    // The same element: a playing video keeps its position across the switch.
    expect(document.querySelector("video")).toBe(video);
    fireEvent.click(screen.getByRole("button", { name: "Open as modal" }));
    expect(document.querySelector("video")).toBe(video);
  });

  it("reopens as the peek and returns to the modal at its remembered size", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    localStorage.setItem("meguri.media.modalSize", "small");
    await openDetail(`/file/1?ws=${WS_ID}`);
    expect(dialog().dataset.presentation).toBe("peek");
    // The peek offers no size toggle of its own — only the way back.
    expect(screen.queryByRole("button", { name: "Enlarge modal" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open as modal" }));
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(barSuppressed()).toBe(true);
    expect(peekDocked()).toBe(false);
    expect(localStorage.getItem("meguri.media.detail.presentation")).toBe(
      "modal",
    );
    // Small, as it was last left — not reset to large by the round trip.
    const toggle = screen.getByRole("button", { name: "Enlarge modal" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("docks at the remembered width and publishes it for the FABs", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    localStorage.setItem("meguri.media.detail.peekWidth", "600");
    await openDetail(`/file/1?ws=${WS_ID}`);
    expect(dialog().style.width).toBe("600px");
    expect(peekInset()).toBe("600px");
    fireEvent.click(screen.getByRole("button", { name: "Open as modal" }));
    // Back to a modal: no width of its own, and the FABs return to the edge.
    expect(dialog().style.width).toBe("");
    expect(peekInset()).toBe("0px");
  });

  it("resizes from the keyboard on the handle, within the minimum", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    await openDetail(`/file/1?ws=${WS_ID}`);
    const handle = screen.getByRole("separator", { name: "Resize side peek" });
    // Left grows the sheet (its edge moves left), right shrinks it.
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(dialog().style.width).toBe("536px");
    expect(localStorage.getItem("meguri.media.detail.peekWidth")).toBe("536");
    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(handle, { key: "ArrowRight" });
    }
    expect(dialog().style.width).toBe("320px");
  });

  it("resizes by dragging the handle and remembers the result", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    await openDetail(`/file/1?ws=${WS_ID}`);
    const panel = dialog();
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      width: 520,
    } as DOMRect);
    const handle = screen.getByRole("separator", { name: "Resize side peek" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 800, pointerId: 1 });
    // A second pointer joining mid-drag is ignored rather than fought over.
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 2 });
    // Dragging the edge 100px to the left widens the sheet by as much, live.
    fireEvent.pointerMove(handle, { clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 2 });
    expect(panel.style.width).toBe("620px");
    expect(handle.getAttribute("aria-valuenow")).toBe("620");
    expect(peekInset()).toBe("620px");
    // Nothing is written until the drag ends: the live width is DOM-only,
    // and docking wrote nothing either since the default already fitted.
    expect(localStorage.getItem("meguri.media.detail.peekWidth")).toBeNull();
    fireEvent.pointerUp(handle, { pointerId: 2 });
    expect(localStorage.getItem("meguri.media.detail.peekWidth")).toBeNull();
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(localStorage.getItem("meguri.media.detail.peekWidth")).toBe("620");
  });

  it("follows a ceiling that moves under a drag", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    await openDetail(`/file/1?ws=${WS_ID}`, "sample.mp4", 1200);
    const panel = dialog();
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      width: 520,
    } as DOMRect);
    const handle = screen.getByRole("separator", { name: "Resize side peek" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 420, pointerId: 1 });
    expect(panel.style.width).toBe("900px");
    // The window narrows mid-drag: 700px row − 240px for the list = 460px.
    Object.defineProperty(panel.parentElement!.parentElement!, "clientWidth", {
      configurable: true,
      get: () => 700,
    });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(panel.style.width).toBe("460px"));
    expect(handle.getAttribute("aria-valuenow")).toBe("460");
    expect(peekInset()).toBe("460px");
    // Releasing keeps the clamped width, not the one the pointer reached.
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(localStorage.getItem("meguri.media.detail.peekWidth")).toBe("460");
  });

  it("keeps the width reached when the view closes mid-drag", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    await openDetail(`/file/1?ws=${WS_ID}`);
    const panel = dialog();
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      width: 520,
    } as DOMRect);
    const handle = screen.getByRole("separator", { name: "Resize side peek" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 750, pointerId: 1 });
    // Esc closes the view with the pointer still down: no pointerup will
    // ever reach the handle, so the drag is finished on the way out.
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(window.location.hash.slice(1)).toBe("/"));
    expect(localStorage.getItem("meguri.media.detail.peekWidth")).toBe("570");
    expect(peekInset()).toBe("0px");
  });

  it("never squeezes the list below its minimum, whatever width was remembered", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    localStorage.setItem("meguri.media.detail.peekWidth", "1400");
    await openDetail(`/file/1?ws=${WS_ID}`, "sample.mp4", 700);
    // 700px row − 240px for the list = 460px at most, applied on docking…
    await waitFor(() => expect(dialog().style.width).toBe("460px"));
    expect(localStorage.getItem("meguri.media.detail.peekWidth")).toBe("460");
    const handle = screen.getByRole("separator", { name: "Resize side peek" });
    expect(handle.getAttribute("aria-valuemax")).toBe("460");
    // …and to every later change.
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(dialog().style.width).toBe("460px");
    // The list keeps its side of the bargain in CSS as well.
    expect(dialog().style.maxWidth).toBe("calc(100% - 240px)");
  });

  it("closes the peek with Esc like the modal", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    await openDetail(`/file/1?ws=${WS_ID}`);
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(window.location.hash.slice(1)).toBe("/"));
  });

  it("can leave a detail reached from the bar while another was docked", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    mocks.fileGet.mockImplementation((id: number) =>
      Promise.resolve(id === 2 ? audioDetail : sampleFileDetail),
    );
    const origin = `/file/1?ws=${WS_ID}`;
    renderWithProviders(
      <DetailRoute detour={{ to: `/file/2?ws=${WS_ID}&autoplay=0`, origin }} />,
      { route: origin },
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "track.mp3" })).toBeTruthy();
    });
    // First Esc: back to the file the detour started from…
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
    });
    expect(window.location.hash.slice(1)).toBe(origin);
    // …and the second one leaves it, rather than returning to it again.
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(window.location.hash.slice(1)).toBe("/"));
  });

  it("keeps the handle's arrow keys from the player", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    await openDetail(`/file/1?ws=${WS_ID}`);
    const video = document.querySelector("video")!;
    video.currentTime = 30;
    const handle = screen.getByRole("separator", { name: "Resize side peek" });
    fireEvent.keyDown(handle, { key: "ArrowRight", code: "ArrowRight" });
    expect(dialog().style.width).toBe("504px");
    // The player also listens for the arrows on window (seek); a key spent on
    // the handle must not reach it.
    expect(video.currentTime).toBe(30);
  });

  it("leaves an Esc that a popup on top has already taken", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    await openDetail(`/file/1?ws=${WS_ID}`);
    // What a Radix dismissable layer does with the Esc that closes it: claim
    // it on the way down, before window listeners see it.
    const claim = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", claim, true);
    try {
      fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    } finally {
      window.removeEventListener("keydown", claim, true);
    }
    expect(window.location.hash.slice(1)).toBe(`/file/1?ws=${WS_ID}`);
    expect(dialog().dataset.presentation).toBe("peek");
  });

  it("moves a docked peek onto a track played from the list, and plays it", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    mocks.fileGet.mockImplementation((id: number) =>
      Promise.resolve(id === 2 ? audioDetail : sampleFileDetail),
    );
    await openDetail(`/file/1?ws=${WS_ID}`);
    expect(peekDocked()).toBe(true);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    fireEvent.click(screen.getByText("play-audio"));
    // The peek, not the list, starts the track — and once.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "track.mp3" })).toBeTruthy();
    });
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(window.location.hash.slice(1)).toBe(`/file/2?ws=${WS_ID}`);
    expect(peekDocked()).toBe(true);
  });

  it("shows an audio track as a tile without its own transport in the peek", async () => {
    localStorage.setItem("meguri.media.detail.presentation", "peek");
    mocks.fileGet.mockResolvedValue(audioDetail);
    await openDetail(`/file/2?ws=${WS_ID}&autoplay=0`, "track.mp3");
    // The bar is the transport here, so the stage's transport region is gone…
    expect(screen.queryByRole("region", { name: "Audio player" })).toBeNull();
    expect(barSuppressed()).toBe(false);
    // …but the tile still offers click-to-play.
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });
});
