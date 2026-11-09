import { describe, expect, it } from "vitest";
import { heldFilterEntries, enableHeldFilter } from "@/lib/heldFilters";
import { en } from "@/i18n/locales/en";
import type { TFunc } from "@/i18n/I18nProvider";

const t: TFunc = (key, params) => {
  let value = en[key];
  for (const [name, replacement] of Object.entries(params ?? {}))
    value = value.replace(`{${name}}`, String(replacement));
  return value;
};

describe("remembered filter states", () => {
  it("makes an incompatible audio filter available but off after the bin changes", () => {
    const held = { kind: "audio", audio: { sampleRate: 96000 } };
    const unavailable = heldFilterEntries(held, { kind: "video" }, {}, t);
    expect(
      unavailable.find((filter) => filter.key === "audio.sampleRate")
        ?.available,
    ).toBe(false);
    const available = heldFilterEntries(held, { kind: "audio" }, {}, t);
    const rate = available.find((filter) => filter.key === "audio.sampleRate")!;
    expect(rate.available).toBe(true);
    expect(rate.patch).toEqual({ kind: "audio", audio: { sampleRate: 96000 } });
    expect(held.audio.sampleRate).toBe(96000);
  });

  it("allows remembered audio properties regardless of contradictory values", () => {
    const choices = heldFilterEntries(
      { audio: { sampleRate: 96000, bitDepth: 24 } },
      {
        kind: "audio",
        audio: { sampleRate: 48000, bitDepth: 16, bitDepthMatch: "atLeast" },
      },
      { kind: "audio" },
      t,
    );
    expect(
      choices.find((entry) => entry.key === "audio.sampleRate")?.available,
    ).toBe(true);
    expect(
      choices.find((entry) => entry.key === "audio.bitDepth")?.available,
    ).toBe(true);
    expect(choices.some((entry) => entry.key === "kind")).toBe(false);
  });

  it("shows independent remembered audio and visual filters", () => {
    const choices = heldFilterEntries(
      {
        kind: "audio",
        audio: { sampleRate: 96000 },
        resolution: { preset: "uhd", match: "atLeast" },
      },
      { kind: "video" },
      {},
      t,
    );
    expect(choices.find((entry) => entry.key === "resolution")?.available).toBe(
      true,
    );
    expect(
      choices.find((entry) => entry.key === "audio.sampleRate")?.available,
    ).toBe(false);
  });

  it("selects the necessary media mode only on explicit activation", () => {
    expect(
      enableHeldFilter(
        {
          kind: "video",
          resolution: { preset: "uhd", match: "exact" },
          ratingMin: 4,
        },
        { kind: "audio", audio: { sampleRate: 96000 } },
      ),
    ).toEqual({ kind: "audio", ratingMin: 4, audio: { sampleRate: 96000 } });
    expect(
      enableHeldFilter(
        { kind: "audio", audio: { bitDepth: 24 } },
        { resolution: { preset: "uhd", match: "atLeast" } },
      ),
    ).toEqual({
      kind: "visual",
      resolution: { preset: "uhd", match: "atLeast" },
    });
  });
});
