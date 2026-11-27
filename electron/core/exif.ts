// A photo's EXIF (and XMP, where EXIF has no date), read with ExifReader
// (#701): the capture time that fills `captured_at`, and the camera details
// kept in `files.exif`. ffprobe reads neither from a still image.
import { DOMParser, onErrorStopParsing } from "@xmldom/xmldom";
import path from "node:path";
import ExifReader from "exifreader";
import type { PhotoExif } from "../../shared/photoInfo.js";

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

/** Never throws. */
export async function readExif(file: string): Promise<ExifResult> {
  let tags: { exif?: Group; xmp?: Group };
  try {
    // Read through the loose Tag shape: the declared per-tag types differ
    // between EXIF and XMP, and only the value or description is wanted.
    const common = {
      expanded: true as const,
      // Passed in rather than left to ExifReader's own lookup, which finds
      // the package only when ExifReader is loaded as CommonJS.
      domParser: new DOMParser({ onError: onErrorStopParsing }),
    };
    tags = (await (hasFixedWindow(file)
      ? ExifReader.load(file, { ...common, length: FIXED_WINDOW })
      : ExifReader.load(file, {
          ...common,
          length: "auto",
          includeOffsets: true,
        }))) as { exif?: Group; xmp?: Group };
  } catch (err) {
    // An fs error (ENOENT, EACCES, EIO) means the file was not read; anything
    // else (MetadataMissingError, UnsupportedFormatError, a broken file) means
    // it was, and has nothing to give.
    const code = (err as NodeJS.ErrnoException | null)?.code;
    return typeof code === "string"
      ? { exif: null, capturedAt: null }
      : { exif: {}, capturedAt: null };
  }
  return { exif: photoExif(tags.exif), capturedAt: capturedAt(tags) };
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
