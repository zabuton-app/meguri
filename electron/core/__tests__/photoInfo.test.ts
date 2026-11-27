import { describe, expect, it } from "vitest";
import {
  cameraName,
  lensName,
  parsePhotoExif,
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
