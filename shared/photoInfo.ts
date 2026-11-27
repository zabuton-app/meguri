// What a photo's stored EXIF says (#701): the camera, the lens and the
// exposure. Shared, like audioInfo.ts, so that the derived tags
// (electron/core/autoMetaTags.ts) and the detail view read a photo the same
// way.
//
// Pure: a value that cannot be read is left out, never a guess.

/**
 * The EXIF details a scan keeps in `files.exif`, as JSON. A field the file
 * does not give is absent; `{}` means the file was read and had none.
 */
export interface PhotoExif {
  make?: string;
  model?: string;
  lens?: string;
  fNumber?: number;
  /** Seconds. */
  exposureTime?: number;
  iso?: number;
  /** Millimetres, as the lens reports it. */
  focalLength?: number;
  /** Millimetres, on a 35 mm frame. */
  focalLength35mm?: number;
}

const STRING_FIELDS = ["make", "model", "lens"] as const;
const NUMBER_FIELDS = [
  "fNumber",
  "exposureTime",
  "iso",
  "focalLength",
  "focalLength35mm",
] as const;

/**
 * The stored `files.exif` value (its JSON, or that JSON parsed), with every
 * field of the wrong type dropped. Null when there is nothing to read.
 */
export function parsePhotoExif(stored: unknown): PhotoExif | null {
  let value = stored;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const src = value as Record<string, unknown>;
  const out: PhotoExif = {};
  for (const key of STRING_FIELDS) {
    const v = src[key];
    if (typeof v === "string") out[key] = v;
  }
  for (const key of NUMBER_FIELDS) {
    const v = src[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/** Camera firmware pads with NULs and spaces; an empty result is no value. */
function tidy(s: string | undefined): string | null {
  if (s == null) return null;
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ");
  return t.trim() || null;
}

/** Company suffixes some makers write in `Make` (`NIKON CORPORATION`). */
const MAKE_SUFFIX =
  /\s+(?:corporation|corp\.?|co\.,?\s*ltd\.?|company|imaging|inc\.?|ltd\.?)$/i;

function shortMake(make: string): string {
  let m = make;
  for (;;) {
    const next = m.replace(MAKE_SUFFIX, "");
    if (next === m) return m;
    m = next;
  }
}

/**
 * The camera as a person would name it: `Canon EOS R5`, `NIKON D850`,
 * `Apple iPhone 15 Pro`. Most makers repeat their name in `Model`; the rest
 * get it put in front. Null without a model.
 */
export function cameraName(exif: PhotoExif): string | null {
  const model = tidy(exif.model);
  if (!model) return null;
  const make = tidy(exif.make);
  if (!make) return model;
  const maker = shortMake(make);
  const firstWord = maker.split(" ")[0].toLowerCase();
  return model.toLowerCase().startsWith(firstWord)
    ? model
    : `${maker} ${model}`;
}

export function lensName(exif: PhotoExif): string | null {
  return tidy(exif.lens);
}

/** A number without a trailing `.0`: 2.5, 30. */
const plain = (n: number) => String(Math.round(n * 10) / 10);

/**
 * `1/120s` for a fraction of a second as cameras name them, `0.7s` or `2.5s`
 * otherwise: 0.7 s is not 1/1 s, and 0.4 s not 1/2 s.
 */
export function shutterLabel(seconds: number): string {
  if (seconds < 1) {
    const n = 1 / seconds;
    const r = Math.round(n);
    // 5%: EXIF stores 1/120 s as 0.0083 and the like.
    if (r >= 2 && Math.abs(n - r) <= n * 0.05) return `1/${r}s`;
  }
  return `${plain(seconds)}s`;
}

/**
 * What the detail view lists about a photo (#725), read when the view opens
 * (`file_photo_details`), as raw values. GPS is not among them until #704
 * settles how a photo's position is shown.
 */
export interface PhotoDetails {
  /** The capture time as the camera's clock showed it, as local Unix seconds. */
  takenAt?: number;
  /** `+09:00`, when the photo records one. */
  takenOffset?: string;
  make?: string;
  model?: string;
  lens?: string;
  fNumber?: number;
  exposureTime?: number;
  iso?: number;
  /** EV; 0 included. */
  exposureBias?: number;
  focalLength?: number;
  focalLength35mm?: number;
  /** EXIF MeteringMode. */
  meteringMode?: number;
  flashFired?: boolean;
  /** EXIF WhiteBalance: 0 auto, 1 manual. */
  whiteBalance?: number;
  /** EXIF ExposureProgram. */
  exposureProgram?: number;
  width?: number;
  height?: number;
  software?: string;
  artist?: string;
  copyright?: string;
}

/** "unreadable" when the file could not be opened (a share that dropped out). */
export type PhotoDetailsResult =
  { status: "ok"; details: PhotoDetails } | { status: "unreadable" };

export type PhotoDetailKey =
  | "taken"
  | "camera"
  | "lens"
  | "aperture"
  | "exposureTime"
  | "iso"
  | "exposureBias"
  | "focalLength"
  | "meteringMode"
  | "flash"
  | "whiteBalance"
  | "exposureProgram"
  | "size"
  | "software"
  | "artist"
  | "copyright";

/**
 * One row of the detail view's list. `value` is ready to show; an enum's row
 * has `valueKey` instead (`metering.pattern`), a message key under
 * `photoDetails.` for the renderer to translate.
 */
export interface PhotoDetailRow {
  key: PhotoDetailKey;
  value?: string;
  valueKey?: string;
  /** The 35 mm equivalent (`24`), on the focal length row when it differs. */
  equiv35?: string;
}

/** EXIF 2.32's values; 0 (unknown), 255 (other) and the rest are left out. */
const METERING: Record<number, string> = {
  1: "average",
  2: "centerWeighted",
  3: "spot",
  4: "multiSpot",
  5: "pattern",
  6: "partial",
};
const PROGRAM: Record<number, string> = {
  1: "manual",
  2: "normal",
  3: "aperture",
  4: "shutter",
  5: "creative",
  6: "action",
  7: "portrait",
  8: "landscape",
};
const WHITE_BALANCE: Record<number, string> = { 0: "auto", 1: "manual" };

/** `-0.7 EV`, `+0.3 EV`, `0 EV`. */
function evLabel(ev: number): string {
  const v = Math.round(ev * 10) / 10;
  return `${v > 0 ? "+" : ""}${v === 0 ? 0 : v} EV`;
}

/**
 * The rows a photo gives, in display order; a field it does not give, or an
 * enum value outside EXIF's list, has no row. `formatTaken` words the capture
 * time in the app's language.
 */
export function photoDetailRows(
  d: PhotoDetails,
  formatTaken: (unix: number) => string,
): PhotoDetailRow[] {
  const rows: PhotoDetailRow[] = [];
  const add = (key: PhotoDetailKey, value: string | null | undefined) => {
    if (value) rows.push({ key, value });
  };
  const addEnum = (
    key: PhotoDetailKey,
    group: string,
    names: Record<number, string>,
    n: number | undefined,
  ) => {
    const name = n === undefined ? undefined : names[n];
    if (name) rows.push({ key, valueKey: `${group}.${name}` });
  };

  if (d.takenAt !== undefined) {
    const when = formatTaken(d.takenAt);
    add("taken", d.takenOffset ? `${when} (${d.takenOffset})` : when);
  }
  add("camera", cameraName(d));
  add("lens", lensName(d));
  if (d.fNumber !== undefined) add("aperture", `f/${plain(d.fNumber)}`);
  if (d.exposureTime !== undefined)
    add("exposureTime", shutterLabel(d.exposureTime));
  if (d.iso !== undefined) add("iso", String(d.iso));
  if (d.exposureBias !== undefined)
    add("exposureBias", evLabel(d.exposureBias));
  if (d.focalLength !== undefined) {
    const row: PhotoDetailRow = {
      key: "focalLength",
      value: `${plain(d.focalLength)} mm`,
    };
    const equiv = d.focalLength35mm;
    if (equiv !== undefined && Math.round(equiv) !== Math.round(d.focalLength))
      row.equiv35 = plain(equiv);
    rows.push(row);
  }
  addEnum("meteringMode", "metering", METERING, d.meteringMode);
  if (d.flashFired !== undefined)
    rows.push({
      key: "flash",
      valueKey: d.flashFired ? "flash.fired" : "flash.notFired",
    });
  addEnum("whiteBalance", "whiteBalance", WHITE_BALANCE, d.whiteBalance);
  addEnum("exposureProgram", "program", PROGRAM, d.exposureProgram);
  if (d.width && d.height) add("size", `${d.width}×${d.height}`);
  add("software", tidy(d.software));
  add("artist", tidy(d.artist));
  add("copyright", tidy(d.copyright));
  return rows;
}
