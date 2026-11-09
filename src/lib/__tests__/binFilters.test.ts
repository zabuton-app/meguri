import { describe, expect, it } from "vitest";
import {
  compatibleBinFilters,
  patchIncoming,
  queryWithinBin,
} from "@/lib/binFilters";
import type { SearchQuery } from "@/ipc/types";
import { hasFilterConditions } from "@/lib/smartCollections";

describe("bin filter compatibility", () => {
  it("treats a paused-result guard as filtering so folder cards cannot broaden the view", () => {
    expect(hasFilterConditions({ matchNone: true })).toBe(true);
  });
  it("keeps folder browsing available for bins without narrowing rules", () => {
    expect(hasFilterConditions(queryWithinBin({}, { sort: "name" }))).toBe(
      false,
    );
    expect(hasFilterConditions(queryWithinBin({}, { ratingMin: 4 }))).toBe(
      true,
    );
  });
  it("preserves an excluded audio setting while a different audio property is edited", () => {
    expect(
      patchIncoming(
        { kind: "audio", audio: { sampleRate: 96000, bitDepth: 24 } },
        { kind: "audio", audio: { bitDepth: 24 } },
        { kind: "audio", audio: { bitDepth: 24, channels: "stereo" } },
      ).audio,
    ).toEqual({ sampleRate: 96000, bitDepth: 24, channels: "stereo" });
  });
  const video: SearchQuery = {
    kind: "video",
    resolution: { preset: "uhd", match: "atLeast" },
  };
  it("keeps general creative filters while excluding audio-only controls", () => {
    const filters: SearchQuery = {
      kind: "audio",
      audio: { sampleRate: 96000, channels: "stereo" },
      ratingMin: 4,
      recent: { period: "today", basis: "added" },
      q: "sunset",
    };
    const result = compatibleBinFilters(filters, video);
    expect(result.applied).toEqual({
      ratingMin: 4,
      recent: filters.recent,
      q: "sunset",
    });
    expect(result.omitted).toEqual({ kind: "audio", audio: filters.audio });
    expect(filters.audio?.sampleRate).toBe(96000);
  });
  it("keeps valid visual filters even when their resolution values cannot match", () => {
    expect(
      compatibleBinFilters(
        { resolution: { preset: "hd", match: "exact" } },
        video,
      ).applied.resolution,
    ).toBeDefined();
    expect(
      compatibleBinFilters(
        { resolution: { preset: "hd", match: "atLeast" } },
        video,
      ).applied.resolution,
    ).toBeDefined();
    expect(
      compatibleBinFilters(
        { resolution: { preset: "uhd", match: "atLeast" } },
        { resolution: { preset: "qhd", match: "exact" } },
      ).applied.resolution,
    ).toBeDefined();
  });
  it("keeps all audio values applicable even when a bin has contradictory audio rules", () => {
    const { applied, omitted } = compatibleBinFilters(
      {
        kind: "audio",
        audio: {
          sampleRate: 96000,
          sampleRateMatch: "exact",
          bitDepth: 16,
          bitDepthMatch: "atLeast",
          channels: "mono",
          durationMin: 120,
        },
      },
      {
        kind: "audio",
        audio: {
          sampleRate: 48000,
          bitDepth: 24,
          channels: "stereo",
          durationMax: 60,
        },
      },
    );
    expect(applied.audio).toEqual({
      sampleRate: 96000,
      sampleRateMatch: "exact",
      bitDepth: 16,
      bitDepthMatch: "atLeast",
      channels: "mono",
      durationMin: 120,
    });
    expect(omitted).toEqual({});
  });
  it("keeps independent AND expressions and never weakens a bin's minimum rating", () => {
    const combined = queryWithinBin(
      { ratingMin: 2, q: "beach|harbour", sort: "name" },
      { ratingMin: 4, q: "sunset|dawn", sort: "rating" },
    );
    expect(combined).toEqual({
      ratingMin: 2,
      q: "beach|harbour",
      sort: "name",
      sortDir: undefined,
      allOf: [{ ratingMin: 4, q: "sunset|dawn" }],
    });
  });
  it("does not discard a text or tag filter merely because it might return no files", () => {
    expect(
      compatibleBinFilters(
        { q: "absent-word tag:missing", tags: ["unusual"] },
        video,
      ).omitted,
    ).toEqual({});
  });
});
