import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import zlib from "node:zlib";
import { exifDateToUnix, readExif } from "../exif.js";

const fx = (name: string) =>
  fileURLToPath(new URL(`./fixtures/exif/${name}`, import.meta.url));

let tmp: string;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "meguri-exif-"));
});
afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("readExif", () => {
  it("reads the capture time with its offset, and the camera details", async () => {
    const r = await readExif(fx("dated-offset.jpg"));
    expect(r.capturedAt).toBe(Date.UTC(2019, 6, 21, 5, 35, 0) / 1000);
    expect(r.exif).toEqual({
      make: "Canon",
      model: "Canon EOS R5",
      lens: "RF24-105mm F4 L IS USM",
      fNumber: 4,
      exposureTime: 0.008,
      iso: 200,
      focalLength: 50,
      focalLength35mm: 50,
    });
  });

  it("reads a time without an offset as local time", async () => {
    const r = await readExif(fx("dated-local.jpg"));
    expect(r.capturedAt).toBe(
      new Date(2019, 6, 21, 14, 35, 0).getTime() / 1000,
    );
  });

  it("keeps the camera when the date is zeroed", async () => {
    const r = await readExif(fx("zero-date.jpg"));
    expect(r.capturedAt).toBeNull();
    expect(r.exif).toEqual({ make: "Apple", model: "iPhone 15 Pro" });
  });

  it("returns an empty object for an image without EXIF", async () => {
    expect(await readExif(fx("no-exif.png"))).toEqual({
      exif: {},
      capturedAt: null,
    });
  });

  it("falls back to XMP for the date", async () => {
    const r = await readExif(fx("xmp-only.png"));
    expect(r.capturedAt).toBe(Date.UTC(2020, 0, 2, 2, 4, 5) / 1000);
  });

  it.each([
    ["dated.webp", "Pixel 8", new Date(2021, 4, 6, 7, 8, 9)],
    ["dated.heic", "iPhone 15 Pro", new Date(2022, 2, 4, 5, 6, 7)],
  ])("reads %s", async (name, model, date) => {
    const r = await readExif(fx(name));
    expect(r.capturedAt).toBe(date.getTime() / 1000);
    expect(r.exif?.model).toBe(model);
  });

  it.each([
    ["dated.tiff", "NIKON Z 8", new Date(2023, 7, 9, 10, 11, 12)],
    ["dated.png", "iPhone 15 Pro", new Date(2024, 0, 2, 3, 4, 5)],
  ])("reads %s", async (name, model, date) => {
    const r = await readExif(fx(name));
    expect(r.capturedAt).toBe(date.getTime() / 1000);
    expect(r.exif?.model).toBe(model);
  });

  it("reads the metadata of a large PNG without reading it whole", async () => {
    // 8 MB of picture-like data after the metadata, as a camera PNG has.
    const png = await fs.readFile(fx("dated.png"));
    const iend = png.length - 12;
    const big = path.join(tmp, "big.png");
    await fs.writeFile(
      big,
      Buffer.concat([
        png.subarray(0, iend),
        chunk("prVt", Buffer.alloc(8 << 20)),
        png.subarray(iend),
      ]),
    );
    // ExifReader warns when length "auto" gives up and reads the whole file.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = await readExif(big);
      expect(r.exif?.model).toBe("iPhone 15 Pro");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("reads an ISO written twice as one value, not a ratio", async () => {
    expect((await readExif(fx("iso-pair.jpg"))).exif?.iso).toBe(100);
  });

  it("returns exif: null when the file cannot be read", async () => {
    expect(await readExif(path.join(tmp, "missing.jpg"))).toEqual({
      exif: null,
      capturedAt: null,
    });
  });

  it("returns {} for a file that is not an image", async () => {
    const garbage = path.join(tmp, "garbage.jpg");
    await fs.writeFile(garbage, "not an image at all");
    expect(await readExif(garbage)).toEqual({ exif: {}, capturedAt: null });
  });
});

/** A PNG chunk: length, type, data, CRC over type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

describe("exifDateToUnix", () => {
  it.each([
    ["2019:07:21 14:35:00", "+09:00", Date.UTC(2019, 6, 21, 5, 35, 0) / 1000],
    ["2019:07:21 14:35:00", "-05:30", Date.UTC(2019, 6, 21, 20, 5, 0) / 1000],
    [
      "2020-01-02T03:04:05+01:00",
      undefined,
      Date.UTC(2020, 0, 2, 2, 4, 5) / 1000,
    ],
    ["0000:00:00 00:00:00", undefined, null],
    ["    :  :     :  :  ", undefined, null],
    ["2019:13:01 00:00:00", undefined, null],
    ["2019:02:30 00:00:00", undefined, null],
  ])("%s %s", (d, o, expected) => {
    expect(exifDateToUnix(d, o)).toBe(expected);
  });

  it("reads a date without an offset as local time", () => {
    expect(exifDateToUnix("2019:07:21 14:35:00")).toBe(
      new Date(2019, 6, 21, 14, 35, 0).getTime() / 1000,
    );
  });
});
