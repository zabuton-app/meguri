// A photo's EXIF (and XMP, where EXIF has no date), read with ExifReader
// (#701): the capture time that fills `captured_at`, and the camera details
// kept in `files.exif`. ffprobe reads neither from a still image.
import { DOMParser, onErrorStopParsing } from "@xmldom/xmldom";
import path from "node:path";
import ExifReader from "exifreader";
import type {
  PhotoDetails,
  PhotoDetailsResult,
  PhotoExif,
} from "../../shared/photoInfo.js";

export interface ExifResult {
  /**
   * What the file says, `{}` when it says nothing (no EXIF, a broken or
   * unsupported file), and null only when the file could not be read at all,
   * so that a later scan tries again.
   */
  exif: PhotoExif | null;
  capturedAt: number | null;
}

interface Tag {
  value?: unknown;
  description?: unknown;
}
type Group = Record<string, Tag | undefined> | undefined;

type Tags = { exif?: Group; xmp?: Group };

/**
 * The file's EXIF and XMP; "unreadable" when the file could not be read at
 * all (an fs error: ENOENT, EACCES, EIO), "empty" when it was read and had
 * nothing to give (MetadataMissingError, UnsupportedFormatError, a broken
 * file). Never throws.
 */
async function loadTags(file: string): Promise<Tags | "unreadable" | "empty"> {
  try {
    const common = {
      expanded: true as const,
      // Passed in rather than left to ExifReader's own lookup, which finds
      // the package only when ExifReader is loaded as CommonJS.
      domParser: new DOMParser({ onError: onErrorStopParsing }),
    };
    // Read through the loose Tag shape: the declared per-tag types differ
    // between EXIF and XMP, and only the value or description is wanted.
    return (await (hasFixedWindow(file)
      ? ExifReader.load(file, { ...common, length: FIXED_WINDOW })
      : ExifReader.load(file, {
          ...common,
          length: "auto",
          includeOffsets: true,
        }))) as Tags;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    return typeof code === "string" ? "unreadable" : "empty";
  }
}

/** Never throws. */
export async function readExif(file: string): Promise<ExifResult> {
  const tags = await loadTags(file);
  if (tags === "unreadable") return { exif: null, capturedAt: null };
  if (tags === "empty") return { exif: {}, capturedAt: null };
  return { exif: photoExif(tags.exif), capturedAt: capturedAt(tags) };
}

/**
 * What the detail view lists about a photo (#725), as raw values: the
 * renderer words and translates them. GPS is left out until #704 settles how
 * a photo's position is shown. Never throws.
 */
export async function readPhotoDetails(
  file: string,
): Promise<PhotoDetailsResult> {
  const tags = await loadTags(file);
  if (tags === "unreadable") return { status: "unreadable" };
  if (tags === "empty") return { status: "ok", details: {} };
  const { exif } = tags;
  const out: PhotoDetails = {};
  const set = <K extends keyof PhotoDetails>(key: K, v: PhotoDetails[K]) => {
    if (v !== undefined) out[key] = v;
  };
  const taken = takenTime(tags);
  if (taken) {
    set("takenAt", taken.at);
    set("takenOffset", taken.offset);
  }
  const camera = photoExif(exif);
  set("make", camera.make);
  set("model", camera.model);
  set("lens", camera.lens);
  set("fNumber", camera.fNumber);
  set("exposureTime", camera.exposureTime);
  set("iso", camera.iso);
  set("exposureBias", signedNum(exif?.ExposureBiasValue));
  set("focalLength", camera.focalLength);
  set("focalLength35mm", camera.focalLength35mm);
  set("meteringMode", int(exif?.MeteringMode));
  const flash = int(exif?.Flash);
  // Bit 0 of the Flash tag says whether it fired; the rest is its mode.
  if (flash !== undefined) set("flashFired", (flash & 1) === 1);
  set("whiteBalance", int(exif?.WhiteBalance));
  set("exposureProgram", int(exif?.ExposureProgram));
  set("width", num(exif?.PixelXDimension));
  set("height", num(exif?.PixelYDimension));
  set("software", text(exif?.Software));
  set("artist", text(exif?.Artist));
  set("copyright", text(exif?.Copyright));
  return { status: "ok", details: out };
}

/**
 * The capture time as the camera's clock showed it (read as local time, so
 * that formatting it gives that wall time back) and the offset recorded with
 * it, from the same sources as capturedAt.
 */
function takenTime(tags: Tags): { at: number; offset?: string } | null {
  const { exif, xmp } = tags;
  const candidates: [string | undefined, string | undefined][] = [
    [
      text(exif?.DateTimeOriginal),
      text(exif?.OffsetTimeOriginal) ?? text(exif?.OffsetTime),
    ],
    [
      text(exif?.DateTimeDigitized),
      text(exif?.OffsetTimeDigitized) ?? text(exif?.OffsetTime),
    ],
    [text(xmp?.DateTimeOriginal), undefined],
    [text(xmp?.CreateDate), undefined],
  ];
  for (const [date, given] of candidates) {
    if (!date) continue;
    // An XMP date carries its offset; take it off to keep the wall time.
    const m = /^(.*?)(Z|[+-]\d{2}:?\d{2})$/.exec(date.trim());
    const wall = m ? m[1] : date;
    const at = exifDateToUnix(wall);
    if (at !== null) {
      const offset = given?.trim() || m?.[2];
      return offset ? { at, offset } : { at };
    }
  }
  return null;
}

/**
 * How much of the file to read: only the bytes that hold the metadata, never
 * the picture. ExifReader finds them itself (`length: "auto"`) in JPEG, HEIC,
 * AVIF, WebP and GIF. In a PNG it does not converge and in a TIFF it is not
 * supported; both would read the whole file (tens of MB, over a network share
 * too), so they get a fixed window. Their writers put the metadata before the
 * image data, which a window this size covers.
 */
const FIXED_WINDOW = 1 << 20;
const FIXED_WINDOW_EXTS = new Set([".png", ".tif", ".tiff"]);

function hasFixedWindow(file: string): boolean {
  return FIXED_WINDOW_EXTS.has(path.extname(file).toLowerCase());
}

function text(tag: Tag | undefined): string | undefined {
  if (!tag) return undefined;
  const v: unknown = Array.isArray(tag.value) ? tag.value[0] : tag.value;
  if (typeof v === "string" && v.trim()) return v;
  return typeof tag.description === "string" && tag.description.trim()
    ? tag.description
    : undefined;
}

function firstOf(v: unknown): unknown {
  return Array.isArray(v) ? (v as unknown[])[0] : v;
}

/** A number, an EXIF rational `[numerator, denominator]`, or a one-item list. */
function num(tag: Tag | undefined): number | undefined {
  const v = tag?.value;
  let n: unknown = v;
  if (Array.isArray(v)) {
    n =
      v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number"
        ? v[1] === 0
          ? NaN
          : v[0] / v[1]
        : v[0];
  }
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Like num(), but zero and negative values count (an exposure bias). */
function signedNum(tag: Tag | undefined): number | undefined {
  const v = tag?.value;
  const n: unknown = Array.isArray(v)
    ? v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number"
      ? v[1] === 0
        ? NaN
        : v[0] / v[1]
      : v[0]
    : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** An enum's number, as written (0 included: it can mean "auto"). */
function int(tag: Tag | undefined): number | undefined {
  const n = firstOf(tag?.value);
  return typeof n === "number" && Number.isInteger(n) ? n : undefined;
}

function photoExif(exif: Group): PhotoExif {
  const out: PhotoExif = {};
  if (!exif) return out;
  const set = <K extends keyof PhotoExif>(key: K, v: PhotoExif[K]) => {
    if (v !== undefined) out[key] = v;
  };
  set("make", text(exif.Make));
  set("model", text(exif.Model));
  set("lens", text(exif.LensModel));
  set("fNumber", num(exif.FNumber));
  set("exposureTime", num(exif.ExposureTime));
  // A list, not a ratio: some cameras write it twice (`[100, 100]`).
  set("iso", num({ value: firstOf(exif.ISOSpeedRatings?.value) }));
  set("focalLength", num(exif.FocalLength));
  set("focalLength35mm", num(exif.FocalLengthIn35mmFilm));
  return out;
}

/**
 * DateTimeOriginal, then DateTimeDigitized, each with its own offset tag (or
 * OffsetTime); then the same two in XMP, which write their offset in the
 * date. XMP only stands in for a date EXIF lacks: cameras write EXIF, and
 * editors that change the date update it too.
 */
function capturedAt(tags: { exif?: Group; xmp?: Group }): number | null {
  const { exif, xmp } = tags;
  const candidates: [string | undefined, string | undefined][] = [
    [
      text(exif?.DateTimeOriginal),
      text(exif?.OffsetTimeOriginal) ?? text(exif?.OffsetTime),
    ],
    [
      text(exif?.DateTimeDigitized),
      text(exif?.OffsetTimeDigitized) ?? text(exif?.OffsetTime),
    ],
    [text(xmp?.DateTimeOriginal), undefined],
    [text(xmp?.CreateDate), undefined],
  ];
  for (const [date, offset] of candidates) {
    const t = date ? exifDateToUnix(date, offset) : null;
    if (t !== null) return t;
  }
  return null;
}

const DATE =
  /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/;
const OFFSET = /^(?:Z|([+-])(\d{2}):?(\d{2}))$/;

/**
 * Unix seconds of an EXIF date (`2019:07:21 14:35:00`) or an XMP one
 * (`2019-07-21T14:35:00+09:00`). Without an offset, in the date or given, the
 * date is read as the computer's local time: what the camera's clock showed,
 * which is the day the timeline should put it on. Null for a date that is
 * blank, zeroed or out of range.
 */
export function exifDateToUnix(date: string, offset?: string): number | null {
  const m = DATE.exec(date.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map((v) => Number(v ?? 0));
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) {
    return null;
  }
  // Rejects a day the month does not have (Feb 30) by checking it survived.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;

  const off = OFFSET.exec((m[7] ?? offset ?? "").trim());
  if (off) {
    const minutes = off[1]
      ? (off[1] === "-" ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3]))
      : 0;
    return Date.UTC(y, mo - 1, d, h, mi, s) / 1000 - minutes * 60;
  }
  return Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000);
}
