import { describe, expect, it } from "vitest";
import { bandEdges, HIGH_HZ, LOW_HZ } from "@/audio/spectrumBands";

describe("bandEdges", () => {
  it("spans LOW_HZ..HIGH_HZ over bars+1 non-decreasing bin indices", () => {
    const bins = 2048;
    const rate = 48_000;
    const edges = bandEdges(64, bins, rate);
    expect(edges).toHaveLength(65);
    const hzPerBin = rate / 2 / bins;
    expect(edges[0]).toBe(Math.round(LOW_HZ / hzPerBin));
    expect(edges[64]).toBe(Math.round(HIGH_HZ / hzPerBin));
    for (let i = 1; i < edges.length; i++)
      expect(edges[i]).toBeGreaterThanOrEqual(edges[i - 1]);
  });

  it("clamps bands above Nyquist to the bin count", () => {
    // 8 kHz output: only bands under 4 kHz have bins behind them.
    const edges = bandEdges(32, 2048, 8_000);
    expect(edges[edges.length - 1]).toBe(2048);
    expect(edges.some((e) => e < 2048)).toBe(true);
    expect(edges.every((e) => e <= 2048)).toBe(true);
  });
});
