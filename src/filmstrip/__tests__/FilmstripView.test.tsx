// The filmstrip view: one row per file, laid out along its length.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { mockVirtualizerScrollToOffset } from "@/test/mockVirtualizer";
import { FilmstripView } from "@/filmstrip/FilmstripView";
import { defaultWorkspacesList, sampleFileRow, WS_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { FileRow } from "@/ipc/types";

const mocks = vi.hoisted(() => ({
  workspacesList: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: { workspacesList: () => mocks.workspacesList() },
  ALL_ID: "__all__",
}));

const BASE = "http://127.0.0.1:17345";
const fetchMock = vi.fn<typeof fetch>();

function row(over: Partial<FileRow>): FileRow {
  return { ...sampleFileRow, ...over };
}

function strip(items: FileRow[], navActive = false, resetKey?: string) {
  return (
    <FilmstripView
      items={items}
      mediaBase={BASE}
      workspaceId={WS_ID}
      loading={false}
      navActive={navActive}
      resetKey={resetKey}
    />
  );
}

function view(items: FileRow[], navActive = false) {
  return renderWithProviders(strip(items, navActive));
}

const fetchedUrls = () => fetchMock.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(new Blob(["x"]), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:frame");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
  // A fixed frame count keeps the frame times independent of layout.
  localStorage.setItem("meguri.prefs", JSON.stringify({ filmstripFrames: 4 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("FilmstripView", () => {
  it("renders one row per item with name, duration, resolution, codec, fps and bookmark count", async () => {
    view([
      row({
        id: 1,
        relPath: "a/interview.mp4",
        codec: "h264",
        fps: 29.97,
        bookmarkSecs: [10, 40],
      }),
      row({ id: 2, relPath: "b/drone.mp4" }),
    ]);
    await screen.findByText("interview.mp4");
    expect(screen.getByText("drone.mp4")).toBeTruthy();
    expect(
      document.querySelectorAll('[data-slot="filmstrip-row"]'),
    ).toHaveLength(2);
    const first = document.querySelector('[data-slot="filmstrip-row"]')!;
    expect(first.textContent).toContain("2:05");
    expect(first.textContent).toContain("1920×1080");
    expect(first.textContent).toContain("h264");
    expect(first.textContent).toContain("29.97 fps");
    expect(first.querySelector('[aria-label="Bookmarks: 2"]')).toBeTruthy();
  });

  it("a video frame links to the detail view at its time", async () => {
    view([row({ id: 7, duration: 100 })]);
    await screen.findByText("sample.mp4");
    const hrefs = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        '[data-slot="filmstrip-frame"]',
      ),
    ).map((a) => a.getAttribute("href"));
    expect(hrefs).toHaveLength(4);
    expect(
      hrefs.map((h) => new URLSearchParams(h!.split("?")[1]).get("t")),
    ).toEqual(["12", "37", "62", "87"]);
    // A frame plays from its time: no autoplay=0.
    expect(hrefs.every((h) => !h!.includes("autoplay=0"))).toBe(true);
    await waitFor(() =>
      expect(fetchedUrls()).toContain(`${BASE}/ws/${WS_ID}/frame/7?t=12&q=low`),
    );
  });

  it("marks each bookmark under the frames as a link to its time", async () => {
    view([row({ id: 7, duration: 100, bookmarkSecs: [25, 50] })]);
    await screen.findByText("sample.mp4");
    const marks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        '[data-slot="filmstrip-bookmark"]',
      ),
    );
    expect(marks.map((m) => m.style.left)).toEqual(["25%", "50%"]);
    expect(marks[0].getAttribute("href")).toContain("t=25");
  });

  it("a video without duration shows its thumbnail and requests no frames", async () => {
    view([row({ id: 3, duration: null })]);
    await screen.findByText("sample.mp4");
    expect(
      document.querySelectorAll('[data-slot="filmstrip-frame"]'),
    ).toHaveLength(0);
    await act(async () => {});
    expect(fetchedUrls().some((u) => u.includes("/frame/"))).toBe(false);
  });

  it("an image row shows its thumbnail once", async () => {
    view([
      row({
        id: 4,
        kind: "image",
        ext: "jpg",
        relPath: "p.jpg",
        duration: null,
      }),
    ]);
    await screen.findByText("p.jpg");
    expect(
      document.querySelectorAll('[data-slot="filmstrip-thumb"]'),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-slot="filmstrip-frame"]'),
    ).toHaveLength(0);
  });

  it("an audio row requests its waveform URL", async () => {
    view([
      row({
        id: 5,
        kind: "audio",
        ext: "m4a",
        relPath: "ep.m4a",
        duration: 3600,
      }),
    ]);
    await screen.findByText("ep.m4a");
    await waitFor(() =>
      expect(fetchedUrls()).toContain(`${BASE}/ws/${WS_ID}/waveform/5`),
    );
  });

  it("a click on the waveform navigates to the time under the pointer", async () => {
    view([
      row({
        id: 5,
        kind: "audio",
        ext: "m4a",
        relPath: "ep.m4a",
        duration: 3600,
      }),
    ]);
    const wave = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-slot="filmstrip-waveform"]',
      );
      expect(el).toBeTruthy();
      return el!;
    });
    vi.spyOn(wave, "getBoundingClientRect").mockReturnValue({
      left: 100,
      width: 400,
      top: 0,
      height: 60,
      right: 500,
      bottom: 60,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.click(wave, { clientX: 200 });
    // 100px into 400px of an hour: 900 s.
    await waitFor(() => expect(window.location.hash).toContain("/file/5?"));
    expect(window.location.hash).toContain("t=900");
    expect(window.location.hash).not.toContain("autoplay=0");
  });

  it("ArrowDown moves focus to the next row and Enter opens it", async () => {
    view(
      [row({ id: 1, relPath: "one.mp4" }), row({ id: 2, relPath: "two.mp4" })],
      true,
    );
    await screen.findByText("two.mp4");
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
    });
    const rows = document.querySelectorAll('[data-slot="filmstrip-row"]');
    expect(rows[1].getAttribute("aria-current")).toBe("true");
    act(() => {
      fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
    });
    await waitFor(() => expect(window.location.hash).toContain("/file/2?"));
  });

  it("a failed frame shows an empty box", async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 500 }),
    );
    view([row({ id: 7, duration: 100 })]);
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-slot="filmstrip-frame"][data-failed]'),
      ).toHaveLength(4),
    );
    expect(
      document.querySelectorAll('[data-slot="filmstrip-frame"] img'),
    ).toHaveLength(0);
  });

  it("in auto mode requests no frames until the strip is measured", async () => {
    localStorage.setItem(
      "meguri.prefs",
      JSON.stringify({ filmstripFrames: "auto" }),
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1100);
    // 72px high at 16:9 is 128px wide; 1100px holds 8 with 4px gaps.
    view([row({ id: 7, duration: 100 })]);
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-slot="filmstrip-frame"] img'),
      ).toHaveLength(8),
    );
    // No frame from a not-yet-measured layout (one frame, at 50 s).
    expect(fetchedUrls().filter((u) => u.includes("/frame/"))).toHaveLength(8);
    expect(fetchedUrls().some((u) => u.includes("t=50&"))).toBe(false);
  });

  it("goes back to the top and drops the focus when resetKey changes", async () => {
    const items = [
      row({ id: 1, relPath: "one.mp4" }),
      row({ id: 2, relPath: "two.mp4" }),
    ];
    const { rerender } = renderWithProviders(strip(items, true, "a"));
    await screen.findByText("two.mp4");
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
    });
    const rows = () => document.querySelectorAll('[data-slot="filmstrip-row"]');
    expect(rows()[0].getAttribute("aria-current")).toBe("true");
    const scrollToOffset = mockVirtualizerScrollToOffset();
    scrollToOffset.mockClear();
    rerender(strip(items, true, "b"));
    expect(scrollToOffset).toHaveBeenCalledWith(0);
    expect(rows()[0].getAttribute("aria-current")).toBeNull();
  });

  it("a Ctrl-click on the waveform selects the row instead of opening it", async () => {
    view([
      row({
        id: 5,
        kind: "audio",
        ext: "m4a",
        relPath: "ep.m4a",
        duration: 3600,
      }),
    ]);
    const wave = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-slot="filmstrip-waveform"]',
      );
      expect(el).toBeTruthy();
      return el!;
    });
    window.location.hash = "#/";
    fireEvent.click(wave, { clientX: 10, ctrlKey: true });
    await act(async () => {});
    expect(window.location.hash).toBe("#/");
    expect(
      document
        .querySelector('[data-slot="filmstrip-row"]')
        ?.getAttribute("data-selected"),
    ).toBe("true");
  });
});
