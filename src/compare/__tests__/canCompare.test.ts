import { describe, expect, it } from "vitest";
import { canCompare } from "../canCompare";

const image = { kind: "image" };
const video = { kind: "video" };

describe("canCompare", () => {
  it("takes exactly two images", () => {
    expect(canCompare({ count: 2, pending: false, rows: [image, image] })).toBe(
      true,
    );
  });

  it("refuses one, three, or a video among them", () => {
    expect(canCompare({ count: 1, pending: false, rows: [image] })).toBe(false);
    expect(
      canCompare({ count: 3, pending: false, rows: [image, image, image] }),
    ).toBe(false);
    expect(canCompare({ count: 2, pending: false, rows: [image, video] })).toBe(
      false,
    );
  });

  it("waits for a picked folder still fetching its files", () => {
    expect(canCompare({ count: 2, pending: true, rows: [image, image] })).toBe(
      false,
    );
  });

  it("refuses a folder past the rows it fetched", () => {
    // A folder with more files than were read: the count says so.
    expect(canCompare({ count: 5, pending: false, rows: [image, image] })).toBe(
      false,
    );
  });
});
