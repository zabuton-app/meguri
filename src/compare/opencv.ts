// The part of OpenCV.js the alignment uses, typed so the tests can pass the
// real module, and how to get it ready to call.

export interface Cv {
  Mat: new () => CvMat;
  Rect: new (x: number, y: number, width: number, height: number) => unknown;
  Size: new (width: number, height: number) => unknown;
  Scalar: new (v0: number) => unknown;
  matchTemplate(
    image: CvMat,
    templ: CvMat,
    result: CvMat,
    method: number,
  ): void;
  meanStdDev(src: CvMat, mean: CvMat, stddev: CvMat): void;
  Sobel(src: CvMat, dst: CvMat, ddepth: number, dx: number, dy: number): void;
  convertScaleAbs(src: CvMat, dst: CvMat): void;
  addWeighted(
    src1: CvMat,
    alpha: number,
    src2: CvMat,
    beta: number,
    gamma: number,
    dst: CvMat,
  ): void;
  minMaxLoc(src: CvMat): {
    maxVal: number;
    maxLoc: { x: number; y: number };
  };
  resize(
    src: CvMat,
    dst: CvMat,
    dsize: unknown,
    fx: number,
    fy: number,
    interpolation: number,
  ): void;
  copyMakeBorder(
    src: CvMat,
    dst: CvMat,
    top: number,
    bottom: number,
    left: number,
    right: number,
    borderType: number,
    value: unknown,
  ): void;
  ORB: new (features: number) => CvOrb;
  BFMatcher: new (normType: number, crossCheck: boolean) => CvMatcher;
  KeyPointVector: new () => CvVector<CvKeyPoint>;
  DMatchVector: new () => CvVector<CvDMatch>;
  BORDER_CONSTANT: number;
  TM_CCOEFF_NORMED: number;
  NORM_HAMMING: number;
  CV_16S: number;
  INTER_AREA: number;
  INTER_LINEAR: number;
}

/** Anything OpenCV allocates on its heap: it is freed only by delete(). */
interface Deletable {
  delete(): void;
}

export interface CvMat extends Deletable {
  cols: number;
  rows: number;
  doubleAt(row: number, col: number): number;
  floatAt(row: number, col: number): number;
  roi(rect: unknown): CvMat;
  clone(): CvMat;
}

export interface CvVector<T> extends Deletable {
  size(): number;
  get(i: number): T;
}

export interface CvKeyPoint {
  pt: { x: number; y: number };
}

export interface CvDMatch {
  queryIdx: number;
  trainIdx: number;
  distance: number;
}

export interface CvOrb extends Deletable {
  detectAndCompute(
    image: CvMat,
    mask: CvMat,
    keypoints: CvVector<CvKeyPoint>,
    descriptors: CvMat,
  ): void;
}

export interface CvMatcher extends Deletable {
  match(query: CvMat, train: CvMat, matches: CvVector<CvDMatch>): void;
}

/**
 * Run `fn`, then free everything it passed to `own`, however it ends. The
 * heap is not garbage collected: a Mat leaked in a loop over scales or
 * guesses adds up, within one comparison, to the 1 GB the heap stops at.
 */
export function withOwned<T>(
  fn: (own: <D extends Deletable>(d: D) => D) => T,
): T {
  const owned: Deletable[] = [];
  try {
    return fn((d) => {
      owned.push(d);
      return d;
    });
  } finally {
    for (const d of owned.reverse()) d.delete();
  }
}

type Loading = Cv & { onRuntimeInitialized?: () => void };

/**
 * OpenCV.js, ready to call. What the package exports depends on the build: a
 * promise of the module, a factory that returns one, or the module itself
 * still initializing.
 */
export async function resolveCv(mod: unknown): Promise<Cv> {
  if (mod instanceof Promise) return (await mod) as Cv;
  if (typeof mod === "function") return await (mod as () => Promise<Cv>)();
  const cv = mod as Loading;
  if (cv.Mat) return cv;
  // Still initializing: wait for its callback, as the package's README does.
  await new Promise<void>((resolve) => {
    cv.onRuntimeInitialized = resolve;
  });
  return cv;
}
