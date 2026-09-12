import { describe, expect, it } from "vitest";
import {
  enteringStyle,
  leavingStyle,
  type Leg,
} from "@/routes/Player/transition";

const MS = 260;

/** Both layers, as they are styled at one point in the switch. */
function pair(leg: Leg, dir: 1 | -1, fade: boolean, slide: boolean) {
  return {
    leaving: leavingStyle(leg, dir, MS, fade, slide),
    entering: enteringStyle(leg, dir, MS, fade, slide),
  };
}

describe("switch geometry", () => {
  it("parks the two layers side by side before releasing them", () => {
    // Armed: the outgoing item still fills the frame and the incoming one waits
    // just off it, so the pair reads as one strip about to move.
    const { leaving, entering } = pair("armed", 1, false, true);
    expect(leaving.transform).toBe("translateX(0%)");
    expect(entering.transform).toBe("translateX(100%)");
  });

  it("moves them together, one frame out and one frame in", () => {
    const { leaving, entering } = pair("running", 1, false, true);
    expect(leaving.transform).toBe("translateX(-100%)");
    expect(entering.transform).toBe("translateX(0%)");
  });

  it("suppresses animation only for the parked frame", () => {
    expect(pair("armed", 1, true, true).entering.transition).toBe("none");
    expect(pair("armed", 1, true, true).leaving.transition).toBe("none");
    expect(pair("running", 1, true, true).entering.transition).toMatch(
      /opacity 260ms .*transform 260ms/,
    );
  });

  it("sends the pair the other way when stepping back", () => {
    const { leaving, entering } = pair("armed", -1, false, true);
    expect(leaving.transform).toBe("translateX(0%)");
    expect(entering.transform).toBe("translateX(-100%)");
    const moved = pair("running", -1, false, true);
    expect(moved.leaving.transform).toBe("translateX(100%)");
    expect(moved.entering.transform).toBe("translateX(0%)");
  });

  it("dissolves rather than slides when only the fade is on", () => {
    const { leaving, entering } = pair("armed", 1, true, false);
    expect(leaving.transform).toBeUndefined();
    expect(entering.transform).toBeUndefined();
    // The outgoing item is fully visible while the incoming one is not yet.
    expect(leaving.opacity).toBe(1);
    expect(entering.opacity).toBe(0);
    const done = pair("running", 1, true, false);
    expect(done.leaving.opacity).toBe(0);
    expect(done.entering.opacity).toBe(1);
  });

  it("keeps both layers opaque when only the slide is on", () => {
    // This is the point of the two layers: the incoming item is on screen and
    // fully visible for the whole slide, instead of a gap between the two.
    for (const leg of ["armed", "running"] as const) {
      const { leaving, entering } = pair(leg, 1, false, true);
      expect(leaving.opacity).toBe(1);
      expect(entering.opacity).toBe(1);
    }
  });

  it("leaves the live layer untouched when no switch is running", () => {
    expect(enteringStyle(null, 1, MS, true, true)).toEqual({});
  });
});
