import { describe, expect, it } from "vitest";
import { formatAudioDuration, parseAudioDuration } from "@/lib/audioDuration";
import { describeConditions } from "@/lib/searchConditions";
import {
  cleanSearchQuery,
  parseSmartCollections,
  describeSearchQuery,
} from "@/lib/smartCollections";
import { en } from "@/i18n/locales/en";
import { SearchQuerySchema, type SearchQuery } from "@shared/ipc/schema";

const t = (key: keyof typeof en, params?: Record<string, string | number>) => {
  let text = en[key];
  for (const [key, value] of Object.entries(params ?? {}))
    text = text.replace(`{${key}}`, String(value));
  return text;
};

describe("audio duration entry", () => {
  it("converts seconds, decimal minutes and MM:SS to the same stored duration", () => {
    expect(parseAudioDuration("150", "seconds")).toBe(150);
    expect(parseAudioDuration("2.5", "minutes")).toBe(150);
    expect(parseAudioDuration("02:30", "time")).toBe(150);
    expect(parseAudioDuration("120:30.5", "time")).toBe(7230.5);
    expect(formatAudioDuration(150, "minutes")).toBe("2.5");
    expect(formatAudioDuration(150, "time")).toBe("02:30");
    expect(formatAudioDuration(0.5, "time")).toBe("00:00.5");
    expect(formatAudioDuration(59.9999, "time")).toBe("01:00");
  });
  it("rejects ambiguous or invalid times and allows an empty bound", () => {
    for (const text of ["2:90", "2:3", "2.5", "02:", "-1:30", "01:30:00"])
      expect(parseAudioDuration(text, "time")).toBeNull();
    for (const text of ["-1", "NaN", "Infinity", "1 minute"])
      expect(parseAudioDuration(text, "seconds")).toBeNull();
    expect(parseAudioDuration("", "time")).toBeUndefined();
    expect(formatAudioDuration(undefined, "time")).toBe("");
  });
  it("keeps audio threshold modes in saved bins and summaries", () => {
    const query: SearchQuery = {
      kind: "audio",
      audio: {
        sampleRate: 96000,
        sampleRateMatch: "atLeast",
        bitDepth: 24,
        bitDepthMatch: "atLeast",
        durationMin: 150,
        durationMatch: "atLeast",
      },
    };
    expect(cleanSearchQuery(query)).toEqual(query);
    const restored = parseSmartCollections(
      JSON.stringify([
        { id: "audio", name: "Audio", query, createdAt: 0, updatedAt: 0 },
      ]),
    )[0];
    expect(restored.query).toEqual(query);
    expect(describeSearchQuery(t, query)).toContain("≥ 96 kHz");
    expect(describeSearchQuery(t, query)).toContain("≥ 24-bit");
  });
  it("clears matching modes together with their values and handles exact duration as one condition", () => {
    const query: SearchQuery = {
      kind: "audio",
      audio: { durationMin: 150, durationMax: 150, durationMatch: "exact" },
    };
    const conditions = describeConditions(query, t).filter((c) =>
      c.key.startsWith("audio."),
    );
    expect(conditions).toHaveLength(1);
    expect(conditions[0].clear(query)).toEqual({ kind: "audio" });
    expect(
      SearchQuerySchema.parse({
        kind: "audio",
        audio: {
          sampleRateMatch: "atLeast",
          bitDepthMatch: "atLeast",
          durationMatch: "atMost",
        },
      }),
    ).toEqual({ kind: "audio" });
  });
});
