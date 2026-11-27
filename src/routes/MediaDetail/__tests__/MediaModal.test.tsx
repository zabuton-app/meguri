// The detail modal holds focus and is named by the file's title; the peek,
// which leaves the list beside it usable, does neither (#287).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TFunc } from "@/i18n/I18nProvider";
import { isImmersiveViewOpen } from "@/components/immersiveView";
import {
  MediaModal,
  TopBar,
  type Presentation,
} from "@/routes/MediaDetail/MediaModal";

const t = ((key: string) => key) as TFunc;

function Detail({ presentation }: { presentation: Presentation }) {
  return (
    <MediaModal
      onClose={vi.fn()}
      presentation={presentation}
      titleId="detail-title"
      t={t}
    >
      <TopBar
        onClose={vi.fn()}
        title="clip.mp4"
        titleId="detail-title"
        presentation={presentation}
        t={t}
      />
    </MediaModal>
  );
}

describe("MediaModal focus", () => {
  it("takes focus as a modal and is named by the file", () => {
    render(
      <>
        <button type="button">opener</button>
      </>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    const { unmount } = render(<Detail presentation="modal" />);
    const dialog = screen.getByRole("dialog", { name: "clip.mp4" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(opener);
  });

  it("leaves focus alone as the peek", () => {
    render(<button type="button">opener</button>);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    render(<Detail presentation="peek" />);
    expect(screen.getByRole("dialog", { name: "clip.mp4" })).toBeTruthy();
    expect(document.activeElement).toBe(opener);
  });
});

describe("MediaModal over the title bar", () => {
  it("covers the whole window, title bar included, as a modal", () => {
    const { rerender, unmount } = render(<Detail presentation="modal" />);
    expect(
      screen.getByRole("dialog", { name: "clip.mp4" }).classList,
    ).toContain("modal-backdrop-full");
    // The title bar's window buttons step aside meanwhile, and come back
    // when it turns into the peek, which sits beside the list below the bar.
    expect(isImmersiveViewOpen()).toBe(true);
    rerender(<Detail presentation="peek" />);
    expect(isImmersiveViewOpen()).toBe(false);
    rerender(<Detail presentation="modal" />);
    expect(isImmersiveViewOpen()).toBe(true);
    unmount();
    expect(isImmersiveViewOpen()).toBe(false);
  });
});
