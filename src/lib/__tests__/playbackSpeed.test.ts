import { describe, expect, it } from "vitest";
import { NORMAL_SPEED, speedKeyStep, stepSpeed } from "@/lib/playbackSpeed";

describe("stepSpeed", () => {
  it("moves one step up or down the list", () => {
    expect(stepSpeed(1, 1)).toBe(1.25);
    expect(stepSpeed(1, -1)).toBe(0.75);
  });

  it("holds at the ends", () => {
    expect(stepSpeed(2, 1)).toBe(2);
    expect(stepSpeed(0.5, -1)).toBe(0.5);
  });

  it("goes back to normal from a speed not on the list", () => {
    expect(stepSpeed(1.1, 1)).toBe(NORMAL_SPEED);
  });
});

describe("speedKeyStep", () => {
  const press = (key: string, code: string) =>
    new KeyboardEvent("keydown", { key, code, shiftKey: true });

  it("reads the character typed", () => {
    expect(speedKeyStep(press(">", "Period"))).toBe(1);
    expect(speedKeyStep(press("<", "Comma"))).toBe(-1);
    // German: "<" has a key of its own.
    expect(speedKeyStep(press("<", "IntlBackslash"))).toBe(-1);
  });

  it("ignores Shift+, where it types something else", () => {
    expect(speedKeyStep(press(";", "Comma"))).toBeNull();
  });
});
