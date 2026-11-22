// Aligns two images off the main thread: decodes both, turns them grey, and
// runs alignImages.ts on them with OpenCV.js. The worker starts only when a
// comparison opens, so OpenCV (about 15 MB) is loaded only then.
//
// Memory is what limits the image size here, not time: OpenCV's wasm heap
// stops at 1 GB. So the colour pixels never enter it — each image is decoded
// and turned grey (one byte a pixel) on the JS side, one at a time, and its
// colour copy is let go before the next is decoded.
import cvModule from "@techstark/opencv-js";
import { alignImages } from "./alignImages";
import { resolveCv, type Cv, type CvMat } from "./opencv";
import type { AlignRequest, AlignResponse } from "./alignProtocol";

type FullCv = Cv & {
  Mat: new (
    rows: number,
    cols: number,
    type: number,
  ) => CvMat & {
    data: Uint8Array;
  };
  CV_8UC1: number;
};

const post = (msg: AlignResponse) => self.postMessage(msg);

async function greyOf(cv: FullCv, url: string): Promise<CvMat> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // The same orientation the <img> shows (EXIF applied), so the offset found
  // here is an offset on screen.
  const bitmap = await createImageBitmap(await res.blob(), {
    imageOrientation: "from-image",
  });
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  let rgba: Uint8ClampedArray;
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0);
    rgba = ctx.getImageData(0, 0, width, height).data;
  } finally {
    bitmap.close();
    // Frees the canvas's pixels now rather than whenever it is collected.
    canvas.width = canvas.height = 0;
  }
  const grey = new cv.Mat(height, width, cv.CV_8UC1);
  const out = grey.data;
  // The weights OpenCV's RGBA2GRAY uses.
  for (let i = 0, j = 0; j < out.length; i += 4, j++)
    out[j] =
      (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114 + 0.5) | 0;
  return grey;
}

/** OpenCV throws its C++ exceptions as bare numbers (a pointer). */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "number")
    return `OpenCV exception ${err} (out of memory for an image this large?)`;
  return String(err);
}

self.onmessage = async (e: MessageEvent<AlignRequest>) => {
  const { a, b } = e.data;
  let matA: CvMat | null = null;
  let matB: CvMat | null = null;
  try {
    const cv = (await resolveCv(cvModule)) as FullCv;
    matA = await greyOf(cv, a);
    matB = await greyOf(cv, b);
    post({ type: "progress", fraction: 0 });
    const result = alignImages(cv, matA, matB, (done, total) =>
      post({ type: "progress", fraction: done / total }),
    );
    post({ type: "result", ...result });
  } catch (err) {
    post({ type: "error", message: messageOf(err) });
  } finally {
    matA?.delete();
    matB?.delete();
  }
};
