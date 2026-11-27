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

/** `1/120s` below a second, `2.5s` from one up. */
export function shutterLabel(seconds: number): string {
  if (seconds < 1) return `1/${Math.round(1 / seconds)}s`;
  return `${plain(seconds)}s`;
}
