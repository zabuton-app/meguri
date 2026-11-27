// Runs the real OpenCV.js: what matters is where matchTemplate puts B.
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { alignImages } from "../alignImages";
import { resolveCv, type Cv, type CvMat } from "../opencv";
import { containedOf, offsetOf, pyramidScales } from "../searchContained";

type FullCv = Cv & {
  CV_8UC1: number;
  INTER_LINEAR: number;
  Mat: new (
    rows?: number,
    cols?: number,
    type?: number,
  ) => CvMat & {
    data: Uint8Array;
    clone(): CvMat;
  };
};

let cv: FullCv;
beforeAll(async () => {
  // Required rather than imported: the package's export is a promise, and
  // Node's ESM wrapper of it is a namespace with a `then` that cannot be
  // awaited.
  const require = createRequire(import.meta.url);
  cv = (await resolveCv(require("@techstark/opencv-js"))) as FullCv;
});

// A picture with detail at every scale (so it survives the coarse level):
// random rectangles of random sizes and shades, from a seeded generator.
function texture(width: number, height: number, seed = 1): Uint8Array {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const px = new Uint8Array(width * height);
  for (let i = 0; i < px.length; i++) px[i] = 128;
  for (let n = 0; n < 1500; n++) {
    const w = 2 + Math.floor(rand() * width * 0.2);
    const h = 2 + Math.floor(rand() * height * 0.2);
    const x0 = Math.floor(rand() * width);
    const y0 = Math.floor(rand() * height);
    const v = Math.floor(rand() * 256);
    for (let y = y0; y < Math.min(height, y0 + h); y++)
      px.fill(v, y * width + x0, y * width + Math.min(width, x0 + w));
  }
  return px;
}

function mat(px: Uint8Array, width: number, height: number) {
  const m = new cv.Mat(height, width, cv.CV_8UC1);
  m.data.set(px);
  return m;
}

/** The part of `src` at (x, y), with `fill` where it falls outside. */
function window(
  src: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = 0,
): Uint8Array {
  const out = new Uint8Array(width * height).fill(fill);
  for (let row = 0; row < height; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= srcHeight) continue;
    for (let col = 0; col < width; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= srcWidth) continue;
      out[row * width + col] = src[sy * srcWidth + sx];
    }
  }
  return out;
}

describe("containedOf", () => {
  it("searches for B as a whole when it fits inside A", () => {
    expect(
      containedOf({ width: 100, height: 80 }, { width: 60, height: 80 }),
    ).toBe("b");
  });

  it("searches for A as a whole when it fits inside B", () => {
    expect(
      containedOf({ width: 60, height: 40 }, { width: 100, height: 80 }),
    ).toBe("a");
  });

  it("has nothing contained for two images of one size", () => {
    // They are searched for over the whole of each other instead.
    expect(
      containedOf({ width: 100, height: 80 }, { width: 100, height: 80 }),
    ).toBeNull();
  });

  it("has nothing contained for crossing sizes", () => {
    expect(
      containedOf({ width: 100, height: 40 }, { width: 60, height: 80 }),
    ).toBeNull();
  });
});

describe("offsetOf", () => {
  it("puts B's corner where B was found in A", () => {
    expect(offsetOf("b", { x: 25, y: 3 })).toEqual({ dx: 25, dy: 3 });
  });

  it("turns the offset around when A was found in B", () => {
    expect(offsetOf("a", { x: 7, y: 0 })).toEqual({ dx: -7, dy: 0 });
  });
});

describe("pyramidScales", () => {
  it("starts at the coarse size and doubles to 1", () => {
    expect(pyramidScales({ width: 1600, height: 900 })).toEqual([0.25, 0.5, 1]);
  });

  it("is only full size for a small image", () => {
    expect(pyramidScales({ width: 300, height: 200 })).toEqual([1]);
  });
});

describe("alignImages", () => {
  it("finds B cut out of A", () => {
    const [w, h] = [900, 600];
    const px = texture(w, h);
    const a = mat(px, w, h);
    const b = mat(window(px, w, h, 123, 77, 500, 400), 500, 400);
    const result = alignImages(cv, a, b);
    expect(result).toMatchObject({ dx: 123, dy: 77 });
    expect(result.score).toBeGreaterThan(0.99);
    a.delete();
    b.delete();
  });

  it("finds A inside a larger B", () => {
    const [w, h] = [900, 600];
    const px = texture(w, h, 7);
    const a = mat(window(px, w, h, 40, 210, 300, 200), 300, 200);
    const b = mat(px, w, h);
    expect(alignImages(cv, a, b)).toMatchObject({ dx: -40, dy: -210 });
    a.delete();
    b.delete();
  });

  it("finds the shift between two images of one size", () => {
    const [w, h] = [1000, 700];
    const px = texture(w, h, 3);
    const a = mat(px, w, h);
    // B's corner shows A's pixel 15 px left of A's edge and 9 px down.
    const b = mat(window(px, w, h, -15, 9, w, h), w, h);
    expect(alignImages(cv, a, b)).toMatchObject({ dx: -15, dy: 9 });
    a.delete();
    b.delete();
  });

  it("refines a large image to the exact pixel with the central patch", () => {
    const [w, h] = [3000, 2000];
    const px = texture(w, h, 11);
    const a = mat(px, w, h);
    const b = mat(window(px, w, h, 211, 133, 2500, 1600), 2500, 1600);
    const levels: number[] = [];
    const result = alignImages(cv, a, b, (done) => levels.push(done));
    expect(result).toMatchObject({ dx: 211, dy: 133 });
    expect(result.score).toBeGreaterThan(0.99);
    // Four levels of the contained search, then the rest as one step.
    expect(levels).toEqual([1, 2, 3, 4, 5]);
    a.delete();
    b.delete();
  });

  it("lines up a copy whose shades are inverted, as a theme switch does", () => {
    // B is A in a "light theme": shades inverted everywhere except a few
    // "photos" that stay as they are, and everything 1 px lower, as a
    // theme's borders can move it (B's corner shows A's row -1).
    // Correlating shades scores the true position negative.
    const [w, h] = [640, 400];
    const px = texture(w, h, 21);
    const themed = window(px, w, h, 0, -1, w, h).map((v) => 255 - v);
    const photo = (x: number, y: number) => {
      for (let row = y; row < y + 60; row++)
        for (let col = x; col < x + 90; col++)
          themed[row * w + col] = px[(row - 1) * w + col];
    };
    photo(40, 40);
    photo(300, 200);
    photo(500, 100);
    const a = mat(px, w, h);
    const b = mat(themed, w, h);
    const result = alignImages(cv, a, b);
    expect(result).toMatchObject({ dx: 0, dy: -1 });
    expect(result.score).toBeGreaterThan(0.9);
    a.delete();
    b.delete();
  });

  it("finds a large shift between two images of one size", () => {
    // 300 px of 800: past the eighth a central crop of one size could see.
    const [w, h] = [800, 600];
    const px = texture(w, h, 31);
    const a = mat(px, w, h);
    const b = mat(window(px, w, h, 300, -40, w, h), w, h);
    const result = alignImages(cv, a, b);
    expect(result).toMatchObject({ dx: 300, dy: -40 });
    expect(result.score).toBeGreaterThan(0.99);
    a.delete();
    b.delete();
  });

  it("finds one disc moved from the left to the right", () => {
    // Little to go by: a single shape on a plain ground.
    const [w, h] = [800, 600];
    const disc = (cx: number) => {
      const px = new Uint8Array(w * h).fill(255);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if ((x - cx) ** 2 + (y - 300) ** 2 <= 80 ** 2) px[y * w + x] = 60;
      return px;
    };
    const a = mat(disc(200), w, h);
    const b = mat(disc(600), w, h);
    const result = alignImages(cv, a, b);
    expect(result).toMatchObject({ dx: -400, dy: 0 });
    expect(result.score).toBeGreaterThan(0.99);
    a.delete();
    b.delete();
  });

  it("finds one disc moved by a fifth of the width", () => {
    // Too few corners on a smooth disc for the features to agree: the search
    // of the whole of B has to find it. Antialiased, as a drawn one is; with
    // hard edges the features happen to find it.
    const [w, h] = [800, 600];
    const disc = (cx: number) => {
      const px = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let cover = 0;
          for (let sy = 0; sy < 4; sy++)
            for (let sx = 0; sx < 4; sx++) {
              const u = x + (sx + 0.5) / 4 - 0.5 - cx;
              const v = y + (sy + 0.5) / 4 - 0.5 - 300;
              if (u * u + v * v <= 80 * 80) cover++;
            }
          px[y * w + x] = Math.round(255 - (195 * cover) / 16);
        }
      return px;
    };
    const a = mat(disc(200), w, h);
    const b = mat(disc(360), w, h);
    const result = alignImages(cv, a, b);
    expect(result).toMatchObject({ dx: -160, dy: 0 });
    expect(result.score).toBeGreaterThan(0.99);
    a.delete();
    b.delete();
  });

  it("finds a copy at half the size", () => {
    const [w, h] = [800, 600];
    const a = mat(texture(w, h, 41), w, h);
    const b = new cv.Mat();
    cv.resize(a, b, new cv.Size(400, 300), 0, 0, cv.INTER_AREA);
    const result = alignImages(cv, a, b);
    expect(result).toMatchObject({ dx: 0, dy: 0 });
    expect(result.scale).toBeCloseTo(2, 2);
    a.delete();
    b.delete();
  });

  it("finds a crop enlarged one and a half times", () => {
    const [w, h] = [800, 600];
    const px = texture(w, h, 43);
    const a = mat(px, w, h);
    const crop = mat(window(px, w, h, 150, 90, 400, 300), 400, 300);
    const b = new cv.Mat();
    cv.resize(crop, b, new cv.Size(600, 450), 0, 0, cv.INTER_LINEAR);
    const result = alignImages(cv, a, b);
    expect(result).toMatchObject({ dx: 150, dy: 90 });
    // Within half a pixel across B's 600.
    expect(Math.abs(result.scale - 2 / 3) * 600).toBeLessThan(0.5);
    for (const m of [a, crop, b]) m.delete();
  });

  it("reports no match for a template of one shade", () => {
    // A blank picture correlates the same everywhere: no offset is better.
    const [w, h] = [400, 300];
    const a = mat(new Uint8Array(w * h).fill(200), w, h);
    const b = mat(new Uint8Array(w * h).fill(200), w, h);
    expect(alignImages(cv, a, b)).toMatchObject({ dx: 0, dy: 0, score: 0 });
    a.delete();
    b.delete();
  });

  it("scores two identical noisy pictures as a match", () => {
    // Per-pixel noise: a downscaled level scores it well under 1 from
    // resampling alone, the full-size one does not.
    const [w, h] = [2400, 1600];
    let s = 5;
    const px = new Uint8Array(w * h).map(() => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s >>> 24;
    });
    const a = mat(px, w, h);
    const b = mat(px, w, h);
    const result = alignImages(cv, a, b);
    expect(result).toMatchObject({ dx: 0, dy: 0 });
    expect(result.score).toBeGreaterThan(0.99);
    a.delete();
    b.delete();
  });

  it("scores two unrelated pictures low", () => {
    const [w, h] = [600, 400];
    const a = mat(texture(w, h, 1), w, h);
    const b = mat(texture(w, h, 99), w, h);
    expect(alignImages(cv, a, b).score).toBeLessThan(0.5);
    a.delete();
    b.delete();
  });
});
