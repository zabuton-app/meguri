// The player's one way out that is not an exit: open the detail view for the
// file on screen, then come back to the same pass at the same second. The
// detail route is a sibling of the player's, so the trip always unmounts the
// player — everything here is about surviving that.
import { StrictMode } from "react";
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

function renderPlayer(
  items: FileRow[],
  route = "/play",
  overrides?: Partial<MediaNav>,
) {
  return renderWithProviders(
    <MediaNavProvider value={nav(items, overrides)}>
      <Player />
    </MediaNavProvider>,
    { route },
  );
}

/** The app runs under StrictMode, whose double-invoked effects are a hazard
 * for anything read once on mount. */
function renderPlayerStrict(items: FileRow[], route: string) {
  return renderWithProviders(
    <StrictMode>
      <MediaNavProvider value={nav(items)}>
        <Player />
      </MediaNavProvider>
    </StrictMode>,
    { route },
  );
}

/** Where the router ended up, without the leading "#". */
const at = () => window.location.hash.slice(1);

/** The <video> serving the given file, once the media URL has been resolved. */
async function videoFor(fileId: number): Promise<HTMLVideoElement> {
  let video: HTMLVideoElement | null = null;
  await waitFor(() => {
    video = document.querySelector("video");
    expect(video?.getAttribute("src")).toContain(`/media/${fileId}`);
  });
  return video!;
}

/** Let the <video> report a position, the way playback would. */
function playTo(seconds: number) {
  const video = document.querySelector("video");
  expect(video).not.toBeNull();
  Object.defineProperty(video!, "currentTime", {
    configurable: true,
    value: seconds,
  });
  fireEvent.timeUpdate(video!);
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

describe("Player detail button", () => {
  it("opens the detail view for the file on screen, from where it had got to", async () => {
    renderPlayer([row(1, "video")]);
    await screen.findByLabelText("Play (Space)");
    playTo(42);
    fireEvent.click(screen.getByLabelText("Open details (I)"));
    await waitFor(() => expect(at()).toContain("/file/1"));
    // The workspace is spelled out: a cross-workspace collection has no active
    // workspace to fall back on.
    expect(at()).toContain(`ws=${WS_ID}`);
    expect(at()).toContain("from=player");
    expect(at()).toContain("t=42");
  });

  it("opens from the start when barely anything has played", async () => {
    // A ?t= makes the server re-encode from that second; paying for it to land
    // where the file already begins is waste.
    renderPlayer([row(1, "video")]);
    await screen.findByLabelText("Play (Space)");
    playTo(1);
    fireEvent.click(screen.getByLabelText("Open details (I)"));
    await waitFor(() => expect(at()).toContain("/file/1"));
    expect(at()).not.toContain("t=");
  });

  it("carries no position for a still image", async () => {
    renderPlayer([row(2, "image")]);
    await screen.findByLabelText("Pause (Space)");
    fireEvent.click(screen.getByLabelText("Open details (I)"));
    await waitFor(() => expect(at()).toContain("/file/2"));
    expect(at()).not.toContain("t=");
  });

  it("answers the I key the same way, whatever kind is on screen", async () => {
    renderPlayer([row(2, "image")]);
    await screen.findByLabelText("Pause (Space)");
    fireEvent.keyDown(window, { code: "KeyI" });
    await waitFor(() => expect(at()).toContain("/file/2"));
    expect(at()).toContain("from=player");
  });

  it("stays inert until there is a file to open", async () => {
    // Still paging the list in: there is a player, but nothing to open yet.
    renderPlayer([], "/play", { hasNextPage: true });
    const button = await screen.findByLabelText("Open details (I)");
    expect(button).toHaveProperty("disabled", true);
  });
});

describe("Player resume after a detour", () => {
  /** Walk into the detail view from the item currently on screen. */
  async function stepOut() {
    fireEvent.click(screen.getByLabelText("Open details (I)"));
    await waitFor(() => expect(at()).toContain("/file/"));
  }

  it("picks the same pass back up where it left off", async () => {
    const items = [row(1, "video"), row(3, "video"), row(5, "video")];
    const first = renderPlayer(items);
    await screen.findByText("1 / 3");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    await screen.findByText("2 / 3");
    await stepOut();
    first.unmount();

    // What the detail view's close hands back: the file the pass was parked on.
    renderPlayer(items, `/play?resume=${WS_ID}:3`);
    // Progress and history survive: without them the user is handed a
    // different-looking playlist that starts over at 1 / 3.
    expect(await screen.findByText("2 / 3")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByLabelText("Previous (P)")).toHaveProperty(
        "disabled",
        false,
      );
    });
  });

  it("resumes the video at the second it was left at", async () => {
    const items = [row(1, "video")];
    const first = renderPlayer(items);
    await screen.findByLabelText("Play (Space)");
    playTo(42);
    await stepOut();
    first.unmount();

    // The detail view watched on to 90s and hands that back, ahead of the 42s
    // the detour was taken at.
    renderPlayer(items, `/play?resume=${WS_ID}:1&t=90`);
    const video = await videoFor(1);
    fireEvent.loadedMetadata(video);
    // Nothing is seekable in jsdom, so the player re-serves the stream from the
    // second it wants — which is where the detail view got to.
    await waitFor(() => expect(video.getAttribute("src")).toContain("t=90"));
  });

  it("falls back to the second it walked out on", async () => {
    // A picture has no player of its own to report a position, so the detail
    // view hands nothing back and the parked second stands.
    const items = [row(1, "video")];
    const first = renderPlayer(items);
    await screen.findByLabelText("Play (Space)");
    playTo(42);
    await stepOut();
    first.unmount();

    renderPlayer(items, `/play?resume=${WS_ID}:1`);
    const video = await videoFor(1);
    fireEvent.loadedMetadata(video);
    await waitFor(() => expect(video.getAttribute("src")).toContain("t=42"));
  });

  it("survives StrictMode's double-invoked mount effects", async () => {
    const items = [row(1, "video"), row(3, "video")];
    const first = renderPlayer(items);
    await screen.findByText("1 / 2");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    await screen.findByText("2 / 2");
    await stepOut();
    first.unmount();

    renderPlayerStrict(items, `/play?resume=${WS_ID}:3`);
    expect(await screen.findByText("2 / 2")).toBeTruthy();
  });

  it("refuses a pass parked on some other file", async () => {
    const items = [row(1, "video"), row(3, "video")];
    const first = renderPlayer(items);
    await screen.findByText("1 / 2");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    await screen.findByText("2 / 2");
    await stepOut();
    first.unmount();

    // Walking the history back to an older detail URL and closing it must not
    // hand over a pass that was parked on a different file.
    renderPlayer(items, `/play?resume=${WS_ID}:1`);
    expect(await screen.findByText("1 / 2")).toBeTruthy();
  });

  it("spends the parked pass once and once only", async () => {
    const items = [row(1, "video"), row(3, "video")];
    const first = renderPlayer(items);
    await screen.findByText("1 / 2");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    await screen.findByText("2 / 2");
    await stepOut();
    first.unmount();

    const second = renderPlayer(items, `/play?resume=${WS_ID}:3`);
    expect(await screen.findByText("2 / 2")).toBeTruthy();
    second.unmount();

    // Same URL, nothing left to pick up: a spent pass must not come back.
    renderPlayer(items, `/play?resume=${WS_ID}:3`);
    expect(await screen.findByText("1 / 2")).toBeTruthy();
  });

  it("starts over when the player is opened without being asked to resume", async () => {
    // Reaching /play any other way — from the list, days later — must not
    // resurrect a pass parked on a detour.
    const items = [row(1, "video"), row(3, "video")];
    const first = renderPlayer(items);
    await screen.findByText("1 / 2");
    fireEvent.click(screen.getByLabelText("Next (N)"));
    await screen.findByText("2 / 2");
    await stepOut();
    first.unmount();

    renderPlayer(items);
    expect(await screen.findByText("1 / 2")).toBeTruthy();
  });

  it("drops the resumed second once the pass moves on", async () => {
    const items = [row(1, "video"), row(3, "video")];
    const first = renderPlayer(items);
    await screen.findByLabelText("Play (Space)");
    playTo(42);
    await stepOut();
    first.unmount();

    renderPlayer(items, `/play?resume=${WS_ID}:1&t=42`);
    await screen.findByText("1 / 2");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Next (N)"));
    });
    await screen.findByText("2 / 2");
    fireEvent.click(screen.getByLabelText("Previous (P)"));
    await screen.findByText("1 / 2");
    const video = await videoFor(1);
    fireEvent.loadedMetadata(video);
    // Back on the same file by ordinary paging: it starts where any other item
    // would, not at the second the user once walked out from.
    expect(video.getAttribute("src")).not.toContain("t=");
  });
});
