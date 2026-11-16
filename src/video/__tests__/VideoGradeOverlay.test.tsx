// The adjustment controls render into the detail view's side panel, which the
// view opens and closes; the trigger stays on the picture.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import type { TFunc } from "@/i18n/I18nProvider";
import { gradeKeys } from "@/video/colorGrade";
import { VideoGradeOverlay } from "@/video/VideoGradeOverlay";

const t = ((key: string) => key) as TFunc;

afterEach(cleanup);

/** The detail view's part: the open state and the panel element. `file`
 *  stands for the file shown (the player keys the overlay by it). */
function View({ file = "a" }: { file?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <div data-testid="player">
        <VideoGradeOverlay
          key={file}
          videoRef={videoRef}
          loaded
          panel={{ open, onOpenChange: setOpen, container: panel }}
          t={t}
        />
      </div>
      {open && <div data-testid="side-panel" ref={setPanel} />}
    </>
  );
}

const trigger = () => screen.getByRole("button", { name: "grade.title" });
const sidePanel = () => screen.queryByTestId("side-panel");

describe("VideoGradeOverlay side panel", () => {
  it("opens the controls in the side panel, not over the picture", () => {
    render(<View />);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger());

    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const aside = screen.getByRole("complementary", { name: "grade.title" });
    expect(sidePanel()?.contains(aside)).toBe(true);
    expect(screen.getByTestId("player").contains(aside)).toBe(false);
    const color = screen.getByRole("region", { name: "grade.color" });
    expect(aside.contains(color)).toBe(true);
    expect(
      screen.getAllByRole("slider").every((slider) => color.contains(slider)),
    ).toBe(true);
    expect(screen.getAllByRole("slider")).toHaveLength(gradeKeys.length);
  });

  it("stays open on the next file, with that file's grade back at neutral", () => {
    const { rerender } = render(<View file="a" />);
    fireEvent.click(trigger());
    const exposure = () =>
      screen.getByRole<HTMLInputElement>("slider", { name: "grade.exposure" });
    fireEvent.change(exposure(), { target: { value: "1" } });
    expect(exposure().value).toBe("1");

    rerender(<View file="b" />);

    expect(sidePanel()).not.toBeNull();
    expect(exposure().value).toBe("0");
  });

  it("closes from the trigger, the close button and Escape", () => {
    render(<View />);

    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(sidePanel()).toBeNull();

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(sidePanel()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("slider", { name: "grade.contrast" }), {
      key: "Escape",
    });
    expect(sidePanel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
