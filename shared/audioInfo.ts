// What an audio file's stored ffprobe output says (#468): its audio stream's
// format, and what a tagger or DJ software wrote into the file (BPM, key,
// genre). Shared so that the derived tags (electron/core/audioMetaTags.ts)
// and the detail view read a file the same way.
//
// Pure: a value that cannot be read is null, never a guess.
import { cleanTagName, isUsableTagName } from "./autoTag.js";

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  bits_per_sample?: number;
  bits_per_raw_sample?: string;
  channels?: number;
  tags?: Record<string, unknown>;
}

interface Probe {
  streams?: ProbeStream[];
  format?: { tags?: Record<string, unknown> };
}

export interface MusicalKey {
  /** `A minor`, `F# major`. */
  name: string;
  /** `8A`. */
  camelot: string;
}

export interface AudioInfo {
  /** ffprobe's codec name, lowercased; empty when it gives none. */
  codec: string;
  sampleRate: number | null;
  /** Bits per sample as ffprobe reports them (the raw ones first). */
  bits: number | null;
  channels: number | null;
  /** Beats per minute as written, to a tenth. */
  bpm: number | null;
  key: MusicalKey | null;
  /** Lowercased, at most MAX_GENRES. */
  genres: string[];
}

const positiveInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/**
 * The file's own tags by lowercased name: the container's first, then the
 * audio stream's (Ogg and Opus keep them on the stream).
 */
function embeddedTags(probe: Probe, stream: ProbeStream): Map<string, string> {
  const out = new Map<string, string>();
  for (const tags of [probe.format?.tags, stream.tags]) {
    if (!tags || typeof tags !== "object") continue;
    for (const [name, value] of Object.entries(tags)) {
      const key = name.toLowerCase();
      if (typeof value === "string" && value.trim() !== "" && !out.has(key))
        out.set(key, value.trim());
    }
  }
  return out;
}

/** The first of `names` the file holds whose value `parse` can read. */
function firstParsed<T>(
  tags: Map<string, string>,
  names: string[],
  parse: (raw: string) => T | null,
): T | null {
  for (const name of names) {
    const raw = tags.get(name);
    const parsed = raw === undefined ? null : parse(raw);
    if (parsed !== null) return parsed;
  }
  return null;
}

/** A written BPM, to a tenth, or null when it is not one (0, above 400). */
export function parseBpm(raw: string): number | null {
  if (!/^\s*\d+(\.\d+)?\s*$/.test(raw)) return null;
  const bpm = Math.round(Number(raw) * 10) / 10;
  return Math.round(bpm) > 0 && bpm <= 400 ? bpm : null;
}

/**
 * How fast a BPM is, for a search that does not want a number: under 90 is
 * slow, from 120 fast, as Andante and Allegro roughly go. The `audio_tempo`
 * tag and the detail view both class a BPM by this.
 */
export function tempoClass(bpm: number): "slow" | "moderate" | "fast" {
  if (bpm < 90) return "slow";
  if (bpm < 120) return "moderate";
  return "fast";
}

/** Camelot wheel names, minor (A) and major (B), by number. */
const MINOR_NAMES = [
  "G# minor",
  "Eb minor",
  "Bb minor",
  "F minor",
  "C minor",
  "G minor",
  "D minor",
  "A minor",
  "E minor",
  "B minor",
  "F# minor",
  "C# minor",
];
const MAJOR_NAMES = [
  "B major",
  "F# major",
  "Db major",
  "Ab major",
  "Eb major",
  "Bb major",
  "F major",
  "C major",
  "G major",
  "D major",
  "A major",
  "E major",
];

const PITCH: Record<string, number> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

/** The Camelot number (1–12) of a major key, by its tonic's pitch class. */
const camelotOfMajor = (pc: number) => ((((pc * 7) % 12) + 7) % 12) + 1;

/**
 * A written key as a musical name and its Camelot code, or null. Understands
 * names (`Am`, `A minor`, `F#m`, `Abm`, `C`, `Cmaj`), Camelot (`8A`) and Open
 * Key (`1m`, `1d`), and those written together, as Mixed In Key can
 * (`8A - Am`, `8A/Am`) when every part names the same key.
 */
export function parseKey(raw: string): MusicalKey | null {
  const parts = raw.split(/\s*[-/|,]\s*/).filter((p) => p.trim() !== "");
  if (parts.length < 2) return parseOneKey(raw);
  const keys = parts.map(parseOneKey);
  const [firstKey] = keys;
  return firstKey !== null &&
    keys.every((k) => k !== null && k.camelot === firstKey.camelot)
    ? firstKey
    : null;
}

function parseOneKey(raw: string): MusicalKey | null {
  const text = raw.trim();
  const fromCamelot = (n: number, minor: boolean) => ({
    name: (minor ? MINOR_NAMES : MAJOR_NAMES)[n - 1],
    camelot: `${n}${minor ? "A" : "B"}`,
  });
  const camelot = /^(1[0-2]|[1-9])\s*([ab])$/i.exec(text);
  if (camelot)
    return fromCamelot(Number(camelot[1]), camelot[2].toLowerCase() === "a");
  const openKey = /^(1[0-2]|[1-9])\s*([md])$/i.exec(text);
  if (openKey) {
    // Open Key 1 is Camelot 8: C major (1d) and A minor (1m).
    const n = ((Number(openKey[1]) + 6) % 12) + 1;
    return fromCamelot(n, openKey[2].toLowerCase() === "m");
  }
  const named = /^([a-g])\s*(#|♯|b|♭)?\s*(m|min|minor|maj|major)?$/i.exec(text);
  if (!named) return null;
  const [, letter, accidental, quality] = named;
  // "m" alone is minor; "M" (a capital) is how some write major.
  const minor =
    quality !== undefined &&
    quality !== "M" &&
    quality.toLowerCase().startsWith("m") &&
    !quality.toLowerCase().startsWith("ma");
  let pc = PITCH[letter.toLowerCase()];
  if (accidental === "#" || accidental === "♯") pc += 1;
  if (accidental === "b" || accidental === "♭") pc -= 1;
  pc = (pc + 12) % 12;
  // A minor key shares its number with its relative major, three up.
  return fromCamelot(camelotOfMajor(minor ? (pc + 3) % 12 : pc), minor);
}

/** At most this many genres per file. */
export const MAX_GENRES = 4;

/** The genres a file lists, lowercased; numeric ID3v1 codes are skipped. */
export function genreNames(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[;/,\0]/)) {
    const name = cleanTagName(part.replace(/^\(\d+\)/, "").toLowerCase());
    if (!isUsableTagName(name) || /^\(?\d+\)?$/.test(name)) continue;
    if (!out.includes(name)) out.push(name);
    if (out.length === MAX_GENRES) break;
  }
  return out;
}

/**
 * What the stored probe output of an audio file says, or null when it holds
 * no audio stream. Never throws.
 */
export function audioInfo(raw: unknown): AudioInfo | null {
  const probe = raw as Probe | null;
  const stream =
    probe && Array.isArray(probe.streams)
      ? probe.streams.find((s) => s?.codec_type === "audio")
      : undefined;
  if (!probe || !stream) return null;
  const tags = embeddedTags(probe, stream);
  const genres = firstParsed(tags, ["genre", "tcon"], (value) => {
    const found = genreNames(value);
    return found.length > 0 ? found : null;
  });
  return {
    codec:
      typeof stream.codec_name === "string"
        ? stream.codec_name.trim().toLowerCase()
        : "",
    sampleRate: positiveInt(stream.sample_rate),
    bits:
      positiveInt(stream.bits_per_raw_sample) ??
      positiveInt(stream.bits_per_sample),
    channels: positiveInt(stream.channels),
    bpm: firstParsed(tags, ["tbpm", "bpm", "tmpo"], parseBpm),
    key: firstParsed(
      tags,
      ["tkey", "initialkey", "initial key", "key"],
      parseKey,
    ),
    genres: genres ?? [],
  };
}
