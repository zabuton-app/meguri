// Comparing two images (#638): the selection bar opens the view, and the
// worker — OpenCV.js under the packaged app's CSP — finds where B sits in A.
//
// A library of its own: the shared fixture has a single image, and adding a
// second there would change what every other spec sees.
import { _electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  electronLaunchOptions,
  mainScript,
} from "../scripts/electron-launch.cjs";
import { skipFirstLaunchTour, waitForIndexedMedia } from "./fixtures/helpers";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An 8-bit greyscale PNG. */
function png(width: number, height: number, px: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++)
    raw.set(px.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Random rectangles: detail at every scale, from a seeded generator. */
function texture(width: number, height: number): Uint8Array {
  let s = 42;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const px = new Uint8Array(width * height).fill(128);
  for (let n = 0; n < 800; n++) {
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

function crop(
  src: Uint8Array,
  srcWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let row = 0; row < height; row++)
    out.set(
      src.subarray((y + row) * srcWidth + x, (y + row) * srcWidth + x + width),
      row * width,
    );
  return out;
}

test("compares two selected images and aligns the crop", async () => {
  if (!fs.existsSync(mainScript))
    throw new Error("Run `npm run build` before E2E tests.");
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-cmp-"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-e2e-"));
  const [w, h] = [640, 480];
  const full = texture(w, h);
  fs.writeFileSync(path.join(mediaRoot, "full.png"), png(w, h, full));
  fs.writeFileSync(
    path.join(mediaRoot, "part.png"),
    png(400, 300, crop(full, w, 37, 29, 400, 300)),
  );

  const app = await _electron.launch(
    electronLaunchOptions({
      args: [`--user-data-dir=${userDataDir}`],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_ROOT: mediaRoot },
    }),
  );
  try {
    const page = await app.firstWindow();
    await skipFirstLaunchTour(page);
    await waitForIndexedMedia(page, "full.png");
    await waitForIndexedMedia(page, "part.png");

    await page.keyboard.press("Control+a");
    const bar = page.getByRole("region", { name: "Selection actions" });
    const compare = bar.getByRole("button", { name: "Compare" });
    await expect(compare).toBeEnabled();
    await compare.click();

    const dialog = page.getByRole("dialog", { name: "Compare images" });
    await expect(dialog).toBeVisible();
    // Which of the two is A follows the selection order; the offset is the
    // same distance either way.
    await expect(dialog.locator('[data-slot="compare-status"]')).toHaveText(
      /Offset (\+37, \+29|-37, -29) px · edge match 100%$/,
      { timeout: 30_000 },
    );

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // The selection outlives the view.
    await expect(bar).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(mediaRoot, { recursive: true, force: true });
  }
});
