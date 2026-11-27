import { describe, expect, it } from "vitest";
import {
  cameraName,
  lensName,
  parsePhotoExif,
  photoDetailRows,
  shutterLabel,
} from "../../../shared/photoInfo.js";

describe("cameraName", () => {
  it.each([
    [{ make: "Canon", model: "Canon EOS R5" }, "Canon EOS R5"],
    [{ make: "NIKON CORPORATION", model: "NIKON D850" }, "NIKON D850"],
    [{ make: "Apple", model: "iPhone 15 Pro" }, "Apple iPhone 15 Pro"],
    [{ make: "OLYMPUS IMAGING CORP.", model: "E-M1" }, "OLYMPUS E-M1"],
    [{ make: "SONY", model: "ILCE-7M3" }, "SONY ILCE-7M3"],
    [{ make: "  FUJIFILM\u0000", model: "X-T4 " }, "FUJIFILM X-T4"],
    [{ model: "X-T4" }, "X-T4"],
    [{ make: "Canon" }, null],
  ])("%j -> %s", (exif, expected) => {
    expect(cameraName(exif)).toBe(expected);
  });
});

describe("lensName", () => {
  it("trims and collapses whitespace", () => {
    expect(lensName({ lens: " RF24-105mm  F4 L IS USM\u0000" })).toBe(
      "RF24-105mm F4 L IS USM",
    );
  });
  it("is null without a lens model", () => {
    expect(lensName({ make: "Canon" })).toBeNull();
  });
});

describe("shutterLabel", () => {
  it.each([
    [1 / 120, "1/120s"],
    [0.0083, "1/120s"],
    [1 / 8000, "1/8000s"],
    [0.5, "1/2s"],
    [0.7, "0.7s"],
    [0.4, "0.4s"],
    [1 / 3, "1/3s"],
    [1, "1s"],
    [2.5, "2.5s"],
    [30, "30s"],
  ])("%d -> %s", (s, expected) => expect(shutterLabel(s)).toBe(expected));
});

describe("parsePhotoExif", () => {
  it("reads the stored JSON and drops mistyped fields", () => {
    expect(
      parsePhotoExif('{"make":"Canon","iso":"100","fNumber":2.8}'),
    ).toEqual({ make: "Canon", fNumber: 2.8 });
  });
  it("accepts an already parsed object", () => {
    expect(parsePhotoExif({ model: "X-T4", iso: 400 })).toEqual({
      model: "X-T4",
      iso: 400,
    });
  });
  it("is an empty object for {}", () => {
    expect(parsePhotoExif("{}")).toEqual({});
  });
  it("is null for null, broken JSON or a non-object", () => {
    expect(parsePhotoExif(null)).toBeNull();
    expect(parsePhotoExif("{")).toBeNull();
    expect(parsePhotoExif("[1]")).toBeNull();
  });
});

describe("photoDetailRows (#725)", () => {
  const taken = (u: number) => `T${u}`;

  it("lists the rows a photo gives, in order", () => {
    expect(
      photoDetailRows(
        {
          takenAt: 100,
          takenOffset: "+09:00",
          make: "Canon",
          model: "Canon EOS R5",
          fNumber: 4,
          exposureTime: 0.008,
          iso: 200,
          exposureBias: -0.7,
          focalLength: 6.765,
          focalLength35mm: 24,
          meteringMode: 5,
          flashFired: false,
          whiteBalance: 1,
          exposureProgram: 3,
          width: 8192,
          height: 5464,
          software: "LR",
        },
        taken,
      ),
    ).toEqual([
      { key: "taken", value: "T100 (+09:00)" },
      { key: "camera", value: "Canon EOS R5" },
      { key: "aperture", value: "f/4" },
      { key: "exposureTime", value: "1/125s" },
      { key: "iso", value: "200" },
      { key: "exposureBias", value: "-0.7 EV" },
      { key: "focalLength", value: "6.8 mm", equiv35: "24" },
      { key: "meteringMode", valueKey: "metering.pattern" },
      { key: "flash", valueKey: "flash.notFired" },
      { key: "whiteBalance", valueKey: "whiteBalance.manual" },
      { key: "exposureProgram", valueKey: "program.aperture" },
      { key: "size", value: "8192×5464" },
      { key: "software", value: "LR" },
    ]);
  });

  it("gives the lens, artist and copyright as written", () => {
    expect(
      photoDetailRows(
        { lens: "RF50mm F1.8 STM", artist: "Jane", copyright: "(c) Jane" },
        taken,
      ),
    ).toEqual([
      { key: "lens", value: "RF50mm F1.8 STM" },
      { key: "artist", value: "Jane" },
      { key: "copyright", value: "(c) Jane" },
    ]);
  });

  it("shows an exposure bias of zero, and a positive one with its sign", () => {
    expect(photoDetailRows({ exposureBias: 0 }, taken)).toEqual([
      { key: "exposureBias", value: "0 EV" },
    ]);
    expect(photoDetailRows({ exposureBias: 1 / 3 }, taken)).toEqual([
      { key: "exposureBias", value: "+0.3 EV" },
    ]);
  });

  it("leaves out unknown or out-of-range enum values", () => {
    expect(
      photoDetailRows({ meteringMode: 0, exposureProgram: 0 }, taken),
    ).toEqual([]);
    expect(
      photoDetailRows(
        { meteringMode: 255, exposureProgram: 42, whiteBalance: 7 },
        taken,
      ),
    ).toEqual([]);
  });

  it("is empty for no details", () => {
    expect(photoDetailRows({}, taken)).toEqual([]);
  });
});
