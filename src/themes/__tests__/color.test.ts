import { describe, expect, it } from "vitest";
import {
  awayFrom,
  contrastRatio,
  ensureContrast,
  fromOklab,
  parseHex,
  pickFirst,
  relativeLuminance,
  toOklab,
} from "../color";

const BLACK = "#000000";
const WHITE = "#ffffff";

describe("parseHex", () => {
  it("reads the channels", () => {
    expect(parseHex("#0f1419")).toEqual([15, 20, 25]);
  });

  it("rejects anything that is not #rrggbb", () => {
    expect(() => parseHex("#fff")).toThrow();
    expect(() => parseHex("rgb(0,0,0)")).toThrow();
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
  });

  it("is 1 for a color against itself", () => {
    expect(contrastRatio("#83a598", "#83a598")).toBeCloseTo(1, 10);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#282828", "#d5c4a1")).toBeCloseTo(
      contrastRatio("#d5c4a1", "#282828"),
      10,
    );
  });

  it("orders by relative luminance", () => {
    expect(relativeLuminance(WHITE)).toBeGreaterThan(relativeLuminance(BLACK));
  });
});

describe("oklab round trip", () => {
  it("returns the original color", () => {
    for (const hex of ["#000000", "#ffffff", "#83a598", "#f07178", "#1e66f5"]) {
      expect(fromOklab(toOklab(hex))).toBe(hex);
    }
  });

  it("keeps hue when only lightness moves", () => {
    const { L, a, b } = toOklab("#f07178");
    const darker = toOklab(fromOklab({ L: L - 0.2, a, b }));
    // Direction of the a/b vector (the hue angle) survives the lightness change.
    expect(Math.atan2(darker.b, darker.a)).toBeCloseTo(Math.atan2(b, a), 2);
    expect(darker.L).toBeLessThan(L);
  });
});

describe("awayFrom", () => {
  it("darkens on light backgrounds and lightens on dark ones", () => {
    expect(awayFrom("#fafafa")).toBe("darker");
    expect(awayFrom("#0f1419")).toBe("lighter");
  });
});

describe("ensureContrast", () => {
  it("leaves a color that already clears the floor untouched", () => {
    const fg = "#d5c4a1";
    expect(ensureContrast(fg, [{ against: "#282828", ratio: 4.5 }])).toBe(fg);
  });

  it("is a no-op with no requirements", () => {
    expect(ensureContrast("#123456", [])).toBe("#123456");
  });

  it("lifts a color to just past the floor", () => {
    const bg = "#fafafa";
    const out = ensureContrast("#f8f9fa", [{ against: bg, ratio: 1.5 }]);
    expect(contrastRatio(out, bg)).toBeGreaterThanOrEqual(1.5);
    // "Nearest color that works", not "as far as it can go".
    expect(contrastRatio(out, bg)).toBeLessThan(1.6);
  });

  it("satisfies every requirement at once", () => {
    const reqs = [
      { against: "#fafafa", ratio: 4.5 },
      { against: "#f3f4f5", ratio: 4 },
    ];
    const out = ensureContrast("#abb0b6", reqs);
    for (const r of reqs) {
      expect(contrastRatio(out, r.against)).toBeGreaterThanOrEqual(r.ratio);
    }
  });

  it("is idempotent", () => {
    const reqs = [{ against: "#fafafa", ratio: 3 }];
    const once = ensureContrast("#f2ae49", reqs);
    expect(ensureContrast(once, reqs)).toBe(once);
  });

  it("honours an explicit direction", () => {
    const bg = "#282828";
    const darker = ensureContrast(
      "#504945",
      [{ against: "#504945", ratio: 1.3 }],
      "darker",
    );
    expect(relativeLuminance(darker)).toBeLessThan(
      relativeLuminance("#504945"),
    );
    expect(relativeLuminance(bg)).toBeLessThan(relativeLuminance("#504945"));
  });

  it("returns a best effort instead of hanging when the floor is unreachable", () => {
    const out = ensureContrast("#808080", [{ against: "#808080", ratio: 21 }]);
    expect(out).toBe(BLACK);
  });
});

describe("pickFirst", () => {
  it("returns the first candidate that qualifies", () => {
    const reqs = [{ against: "#eff1f5", ratio: 4.5 }];
    expect(pickFirst(["#dc8a78", "#4c4f69"], reqs)).toBe("#4c4f69");
  });

  it("returns undefined when none does", () => {
    expect(pickFirst(["#ffffff"], [{ against: "#ffffff", ratio: 3 }])).toBe(
      undefined,
    );
  });
});
