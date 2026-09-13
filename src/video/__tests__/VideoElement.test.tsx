// The element behind VideoPlayer: one per host normally, handed over intact
// between two hosts that show the same file back to back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode, useRef } from "react";
import { VideoElement } from "@/video/VideoElement";
import {
  announceVideoHandOff,
  HAND_OFF_ANNOUNCE_MS,
  HAND_OFF_PARK_MS,
  resetVideoHandOff,
} from "@/video/videoHandOff";

const SRC_A = "http://127.0.0.1:1/ws/ws1/media/1";
const SRC_B = "http://127.0.0.1:1/ws/ws1/media/2";

let pauseSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pauseSpy = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    pauseSpy as unknown as HTMLMediaElement["pause"],
  );
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(async () => {
  // Unmount here rather than in the library's own afterEach (which runs after
  // this one), then let a discarded element's deferred teardown run inside its
  // own test instead of counting against the next.
  cleanup();
  await new Promise((r) => setTimeout(r, 0));
  resetVideoHandOff();
  vi.restoreAllMocks();
});

/** A host: the wrapper a player would render around its video. */
function Host({
  src,
  onElement,
}: {
  src: string;
  onElement?: (el: HTMLVideoElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  return (
    <div data-testid="wrap">
      <VideoElement
        videoRef={ref}
        src={src}
        autoPlay
        className="h-full"
        onLoadedMetadata={() => onElement?.(ref.current)}
      />
    </div>
  );
}

const videos = () => document.querySelectorAll("video");

/** Let the deferred teardown of a discarded element run. */
async function nextTask() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("VideoElement", () => {
  it("gives each host its own element, placed where a JSX <video> would be", () => {
    const { getByTestId } = render(<Host src={SRC_A} />);
    const wrap = getByTestId("wrap");
    const video = wrap.querySelector("video")!;
    expect(video.parentElement).toBe(wrap);
    expect(video.getAttribute("src")).toBe(SRC_A);
    expect(video.autoplay).toBe(true);
    expect(video.className).toBe("h-full");
  });

  it("tears the element down when its host goes, outside a hand-off", async () => {
    const { unmount } = render(<Host src={SRC_A} />);
    const video = videos()[0];
    unmount();
    // Gone from the document at once (a host that left must not leave a
    // video behind)...
    expect(videos()).toHaveLength(0);
    // ...and stopped and released a task later.
    await nextTask();
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(video.hasAttribute("src")).toBe(false);
  });

  it("hands a playing element over to the next host showing the same file", async () => {
    const first = render(<Host src={SRC_A} />);
    const video = videos()[0];
    announceVideoHandOff(SRC_A);
    first.unmount();
    // Parked, not torn down: still in the document, still playing.
    expect(document.contains(video)).toBe(true);
    await nextTask();
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(video.getAttribute("src")).toBe(SRC_A);

    const second = render(<Host src={SRC_A} />);
    const wrap = second.getByTestId("wrap");
    // The very same element, moved into the new host with its source untouched.
    expect(wrap.querySelector("video")).toBe(video);
    expect(videos()).toHaveLength(1);
    expect(video.getAttribute("src")).toBe(SRC_A);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it("keeps a re-served stream's element: the source is compared without ?t=", () => {
    const first = render(<Host src={SRC_A} />);
    const video = videos()[0];
    video.src = `${SRC_A}?t=90`;
    announceVideoHandOff(SRC_A);
    first.unmount();
    render(<Host src={SRC_A} />);
    expect(videos()[0]).toBe(video);
    expect(video.getAttribute("src")).toBe(`${SRC_A}?t=90`);
  });

  it("gives a host for another file a fresh element and tears the parked one down", async () => {
    const first = render(<Host src={SRC_A} />);
    const parked = videos()[0];
    announceVideoHandOff(SRC_A);
    first.unmount();
    const { getByTestId } = render(<Host src={SRC_B} />);
    const video = getByTestId("wrap").querySelector("video")!;
    expect(video).not.toBe(parked);
    expect(video.getAttribute("src")).toBe(SRC_B);
    // The announced host is evidently not coming: nothing keeps playing.
    expect(document.contains(parked)).toBe(false);
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    await nextTask();
    expect(parked.hasAttribute("src")).toBe(false);
  });

  it("lets a host that learns its source late adopt the parked element", () => {
    const first = render(<Host src={SRC_A} />);
    const parked = videos()[0];
    announceVideoHandOff(SRC_A);
    first.unmount();
    // Mounted before the media origin was known: no source, nothing decided.
    const second = render(<Host src="" />);
    expect(document.contains(parked)).toBe(true);
    second.rerender(<Host src={SRC_A} />);
    const wrap = second.getByTestId("wrap");
    expect(wrap.querySelector("video")).toBe(parked);
    expect(videos()).toHaveLength(1);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it("tears a parked element down when nobody comes for it", () => {
    vi.useFakeTimers();
    try {
      const first = render(<Host src={SRC_A} />);
      const video = videos()[0];
      announceVideoHandOff(SRC_A);
      first.unmount();
      expect(document.contains(video)).toBe(true);
      act(() => {
        vi.advanceTimersByTime(HAND_OFF_PARK_MS);
      });
      expect(document.contains(video)).toBe(false);
      expect(pauseSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("parks only the element playing the announced source", () => {
    const other = render(<Host src={SRC_B} />);
    const otherVideo = videos()[0];
    announceVideoHandOff(SRC_A);
    // An unrelated host leaving inside the window is torn down as usual.
    other.unmount();
    expect(document.contains(otherVideo)).toBe(false);
    // The announcement is still open for the right element.
    const first = render(<Host src={SRC_A} />);
    const video = videos()[0];
    first.unmount();
    expect(document.contains(video)).toBe(true);
  });

  it("never parks an element that has failed", async () => {
    const first = render(<Host src={SRC_A} />);
    const video = videos()[0];
    Object.defineProperty(video, "error", {
      configurable: true,
      value: { code: 4 },
    });
    announceVideoHandOff(SRC_A);
    first.unmount();
    // Adopting it would leave the next host waiting for a load that never
    // comes; it is torn down like any other.
    expect(document.contains(video)).toBe(false);
    await nextTask();
    expect(pauseSpy).toHaveBeenCalledTimes(1);
  });

  it("reports whether the attached element was adopted, consistently", () => {
    const seen: boolean[] = [];
    const onAttach = (_el: HTMLVideoElement, adopted: boolean) =>
      seen.push(adopted);
    function Reporting({ src }: { src: string }) {
      const ref = useRef<HTMLVideoElement | null>(null);
      return (
        <VideoElement
          videoRef={ref}
          src={src}
          autoPlay
          className=""
          onAttach={onAttach}
        />
      );
    }
    const first = render(<Reporting src={SRC_A} />);
    expect(seen).toEqual([false]);
    announceVideoHandOff(SRC_A);
    first.unmount();
    render(
      <StrictMode>
        <Reporting src={SRC_A} />
      </StrictMode>,
    );
    // Adopted, and still reported as adopted on StrictMode's re-attach.
    expect(seen.slice(1)).toEqual([true, true]);
  });

  it("does not honour a stale announcement", () => {
    vi.useFakeTimers();
    try {
      announceVideoHandOff(SRC_A);
      vi.advanceTimersByTime(HAND_OFF_ANNOUNCE_MS + 1);
      const first = render(<Host src={SRC_A} />);
      const video = videos()[0];
      first.unmount();
      expect(document.contains(video)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives StrictMode's double-invoked effects with one element and no reload", async () => {
    render(
      <StrictMode>
        <Host src={SRC_A} />
      </StrictMode>,
    );
    expect(videos()).toHaveLength(1);
    const video = videos()[0];
    await nextTask();
    // Neither torn down by the rehearsal cleanup nor replaced by a second one.
    expect(document.contains(video)).toBe(true);
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(video.getAttribute("src")).toBe(SRC_A);
  });

  it("never gives the element an empty src attribute", () => {
    // React drops the attribute for ""; assigning "" would start a load that
    // fails with MEDIA_ERR_SRC_NOT_SUPPORTED and take the player down with it.
    const { rerender } = render(<Host src="" />);
    const video = videos()[0];
    expect(video.hasAttribute("src")).toBe(false);
    rerender(<Host src={SRC_A} />);
    expect(video.getAttribute("src")).toBe(SRC_A);
    rerender(<Host src="" />);
    expect(video.hasAttribute("src")).toBe(false);
  });

  it("switches source on the same element when the host changes file", () => {
    const { rerender } = render(<Host src={SRC_A} />);
    const video = videos()[0];
    rerender(<Host src={SRC_B} />);
    expect(videos()[0]).toBe(video);
    expect(video.getAttribute("src")).toBe(SRC_B);
  });

  it("delivers element events to the latest handlers", () => {
    const seen: (HTMLVideoElement | null)[] = [];
    render(<Host src={SRC_A} onElement={(el) => seen.push(el)} />);
    const video = videos()[0];
    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(seen).toEqual([video]);
  });
});
