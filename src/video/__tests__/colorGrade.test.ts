import { describe, expect, it } from "vitest";
import {
  filmicContrast,
  hasHdrTransfer,
  neutralGrade,
  toneCurvePivotInput,
  videoToneCurve,
} from "../colorGrade";

describe("preview color curves", () => {
  it("holds the pivot and endpoints while separating tones around the pivot", () => {
    const pivot = 0.18;
    expect(filmicContrast(0, 1.4, pivot)).toBe(0);
    expect(filmicContrast(pivot, 1.4, pivot)).toBeCloseTo(pivot, 12);
    expect(filmicContrast(1, 1.4, pivot)).toBe(1);
    expect(filmicContrast(0.12, 1.4, pivot)).toBeLessThan(0.12);
    expect(filmicContrast(0.24, 1.4, pivot)).toBeGreaterThan(0.24);
    const highlights = [0.7, 0.8, 0.9].map((x) =>
      filmicContrast(x, 1.4, pivot),
    );
    expect(highlights[0]).toBeLessThan(highlights[1]);
    expect(highlights[1]).toBeLessThan(highlights[2]);
    expect(highlights[2]).toBeLessThan(1);
  });

  it("lets exposure double linear light below the knee and rolls off brighter steps", () => {
    const curve = (input: number) =>
      videoToneCurve(input, { ...neutralGrade, exposure: 1 });
    expect(curve(0.18)).toBeCloseTo(0.36, 12);
    expect(curve(0.5)).toBeLessThan(curve(0.75));
    expect(curve(0.75)).toBeLessThan(curve(0.9));
    expect(curve(0.9)).toBeLessThan(curve(1));
    expect(curve(1)).toBeCloseTo(1, 12);
    expect(videoToneCurve(1, { ...neutralGrade, exposure: -1 })).toBe(0.5);
  });

  it("marks the contrast pivot after exposure, including above the shoulder knee", () => {
    const grade = { exposure: 2, contrast: 1.4, pivot: 0.6 };
    const input = toneCurvePivotInput(grade);
    expect(input).toBeLessThan(grade.pivot);
    expect(videoToneCurve(input, grade)).toBeCloseTo(grade.pivot, 12);
    expect(toneCurvePivotInput({ ...grade, exposure: -2 })).toBeGreaterThan(1);
  });
});

describe("SDR adjustment availability", () => {
  const streams = (transfer: string) => ({
    streams: [
      {
        codec_type: "video",
        color_transfer: "smpte2084",
        disposition: { attached_pic: 1 },
      },
      { codec_type: "video", color_transfer: transfer },
    ],
  });

  it("checks the primary video transfer and ignores attached covers", () => {
    expect(hasHdrTransfer(streams("smpte2084"))).toBe(true);
    expect(hasHdrTransfer(streams("arib-std-b67"))).toBe(true);
    expect(hasHdrTransfer(streams("bt709"))).toBe(false);
    expect(hasHdrTransfer(null)).toBe(false);
  });
});
