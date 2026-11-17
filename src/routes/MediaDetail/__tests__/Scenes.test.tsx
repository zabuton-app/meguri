import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Scenes } from "@/routes/MediaDetail/Scenes";

vi.mock("@/settings/PreferencesProvider", () => ({
  usePreferences: () => ({ sceneCount: 3 }),
}));

const frameImages = (container: HTMLElement) =>
  container.querySelectorAll('img[src*="/frame/"]');

function renderScenes(id: number) {
  return render(
    <Scenes
      id={id}
      total={600}
      mediaBase="http://media"
      wsId="ws"
      thumbOffsetSec={null}
      pendingThumbSec={undefined}
      mainThumbUrl={null}
      mainThumbPending={false}
      onSeek={() => {}}
      onSetMainThumb={() => {}}
      t={(key: string) => key}
    />,
  );
}

describe("Scenes frame requests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not request scene frames until the file has been shown for a while", () => {
    const { container, rerender } = renderScenes(1);
    // Skimming past a file must not queue frame extraction for it.
    expect(frameImages(container).length).toBe(0);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(frameImages(container).length).toBe(3);

    // Moving on to another file restarts the delay.
    rerender(
      <Scenes
        id={2}
        total={600}
        mediaBase="http://media"
        wsId="ws"
        thumbOffsetSec={null}
        pendingThumbSec={undefined}
        mainThumbUrl={null}
        mainThumbPending={false}
        onSeek={() => {}}
        onSetMainThumb={() => {}}
        t={(key: string) => key}
      />,
    );
    expect(frameImages(container).length).toBe(0);

    // Returning to the first file must wait for the delay again, not reuse the old grant.
    rerender(
      <Scenes
        id={1}
        total={600}
        mediaBase="http://media"
        wsId="ws"
        thumbOffsetSec={null}
        pendingThumbSec={undefined}
        mainThumbUrl={null}
        mainThumbPending={false}
        onSeek={() => {}}
        onSetMainThumb={() => {}}
        t={(key: string) => key}
      />,
    );
    expect(frameImages(container).length).toBe(0);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(frameImages(container).length).toBe(3);
  });
});
