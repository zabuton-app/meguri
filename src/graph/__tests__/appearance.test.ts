import { describe, expect, it } from "vitest";
import { fade, nodeRadius } from "../model/appearance";

describe("nodeRadius", () => {
  it("grows with the square root of the links, between 8 and 30", () => {
    expect(nodeRadius(0)).toBe(8);
    expect(nodeRadius(15)).toBe(12);
    expect(nodeRadius(10_000)).toBe(30);
    expect(nodeRadius(15, 2)).toBe(24);
  });
});

describe("fade", () => {
  it("mixes a colour into the background", () => {
    expect(fade("#ffffff", "#000000", 0.2)).toBe("#333333");
    expect(fade("#f00", "#0000ff", 0.5)).toBe("#800080");
    expect(fade("rgb(200, 100, 0)", "rgb(0 0 0)", 0.5)).toBe("#643200");
    expect(fade("#123456", "#abcdef", 1)).toBe("#123456");
  });

  it("leaves colours it cannot read alone", () => {
    expect(fade("red", "#000000", 0.2)).toBe("red");
    expect(fade("#ffffff", "transparent", 0.2)).toBe("#ffffff");
  });
});
