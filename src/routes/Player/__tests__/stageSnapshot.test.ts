import { describe, expect, it } from "vitest";
import { captureStage } from "@/routes/Player/stageSnapshot";

function root(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("captureStage", () => {
  it("captures the image that is on screen, pan and zoom included", () => {
    const el = root();
    const img = document.createElement("img");
    img.setAttribute("data-slot", "player-media");
    Object.defineProperty(img, "currentSrc", {
      value: "http://127.0.0.1:1/ws/w/media/7",
    });
    img.style.transform = "translate(3%, 4%) scale(1.2)";
    el.appendChild(img);

    const snap = captureStage(el, "w:7", "http://127.0.0.1:1/ws/w/thumb/7");
    expect(snap?.imageSrc).toBe("http://127.0.0.1:1/ws/w/media/7");
    expect(snap?.backdropSrc).toBe("http://127.0.0.1:1/ws/w/thumb/7");
    // Without the transform the still would jump back to the start of the motion.
    expect(snap?.transform).toBe("translate(3%, 4%) scale(1.2)");
    expect(snap?.key).toBe("w:7");
  });

  it("returns nothing when there is no media to freeze", () => {
    expect(captureStage(root(), "w:7")).toBeNull();
    expect(captureStage(null, "w:7")).toBeNull();
  });

  it("skips a video that has not produced a frame yet", () => {
    const el = root();
    el.appendChild(document.createElement("video"));
    // videoWidth is 0 until metadata arrives; a 0x0 canvas is not a still.
    expect(captureStage(el, "w:7")).toBeNull();
  });
});
