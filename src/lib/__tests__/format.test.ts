import { describe, expect, it } from "vitest";
import { formatDuration, formatSize } from "@/lib/format";

describe("formatDuration", () => {
  it("returns the fallback for null / 0 / negative / NaN", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(-1)).toBe("");
    expect(formatDuration(NaN)).toBe("");
  });

  it("honors a custom fallback string", () => {
    expect(formatDuration(null, { fallback: "—" })).toBe("—");
    expect(formatDuration(0, { hours: true, fallback: "—" })).toBe("—");
  });

  it("formats m:ss by default", () => {
    // Sub-second positive values fall through the falsy/<=0 guard and render as "0:00".
    expect(formatDuration(0.9)).toBe("0:00");
    expect(formatDuration(1)).toBe("0:01");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(599)).toBe("9:59");
    // No hours rollover in the compact (list) form: 1h05m05s is rendered as 65:05.
    expect(formatDuration(3905)).toBe("65:05");
  });

  it("omits the hours field when hours:true but h=0", () => {
    expect(formatDuration(125, { hours: true })).toBe("2:05");
    expect(formatDuration(3599, { hours: true })).toBe("59:59");
  });

  it("includes hours when h>0 and zero-pads minutes/seconds", () => {
    expect(formatDuration(3600, { hours: true })).toBe("1:00:00");
    expect(formatDuration(3725, { hours: true })).toBe("1:02:05");
    expect(formatDuration(36005, { hours: true })).toBe("10:00:05");
  });
});

describe("formatSize", () => {
  it("returns the fallback for null / 0", () => {
    expect(formatSize(null)).toBe("");
    expect(formatSize(0)).toBe("");
    expect(formatSize(null, "—")).toBe("—");
    expect(formatSize(0, "—")).toBe("—");
  });

  it.each([
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024, "1.0 MB"],
    [1024 * 1024 * 1024, "1.0 GB"],
    // The unit table caps at GB; 1 TiB renders as "1024.0 GB" rather than rolling over.
    [1024 ** 4, "1024.0 GB"],
  ])("formatSize(%i) === %s", (input, expected) => {
    expect(formatSize(input)).toBe(expected);
  });
});
