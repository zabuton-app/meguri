import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Scenes } from "@/routes/MediaDetail/Scenes";

vi.mock("@/settings/PreferencesProvider", () => ({
  usePreferences: () => ({ sceneCount: 3 }),
}));

const frameImages = (container: HTMLElement) =>
  container.querySelectorAll('img[src*="/frame/"]');
const placeholders = (container: HTMLElement) =>
  container.querySelectorAll('[data-testid="scene-placeholder"]');

function scenes(id: number) {
  return (
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
    />
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
    const { container, rerender } = render(scenes(1));
    // Skimming past a file must not queue frame extraction for it.
    expect(frameImages(container).length).toBe(0);
    expect(placeholders(container).length).toBe(3);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(frameImages(container).length).toBe(3);
    expect(placeholders(container).length).toBe(0);

    // Moving on to another file restarts the delay.
    rerender(scenes(2));
    expect(frameImages(container).length).toBe(0);
    expect(placeholders(container).length).toBe(3);

    // Returning to the first file must wait for the delay again, not reuse the old grant.
    rerender(scenes(1));
    expect(frameImages(container).length).toBe(0);
    expect(placeholders(container).length).toBe(3);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(frameImages(container).length).toBe(3);
    expect(placeholders(container).length).toBe(0);
  });
});
