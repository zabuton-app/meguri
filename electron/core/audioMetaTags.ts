// Derived tags for audio files (#468), from the ffprobe output the scan stores
// in `files.meta`: the audio stream's codec, sample rate, bit depth and
// channels, and the tags a tagger or DJ software wrote into the file (BPM,
// key, genre). No file is read again.
//
// Pure, like autoMetaTagsFor: a value that cannot be read gives no tag, never
// a guessed one.
import { cleanTagName, isUsableTagName } from "../../shared/autoTag.js";
import type { DerivedTag } from "./autoMetaTags.js";
import { codecTagName, durationClass } from "./derivedTagClasses.js";

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

/**
 * Each ffprobe audio codec: the tag it gets, and whether it keeps every
 * sample (null when the codec does not say, as DTS does not). One table, so a
 * codec cannot get a tag without a quality or the other way round.
 */
const AUDIO_CODECS: Record<string, { tag: string; lossless: boolean | null }> =
  {
    mp3: { tag: "mp3", lossless: false },
    mp3float: { tag: "mp3", lossless: false },
    aac: { tag: "aac", lossless: false },
    aac_latm: { tag: "aac", lossless: false },
    opus: { tag: "opus", lossless: false },
    vorbis: { tag: "vorbis", lossless: false },
    ac3: { tag: "ac3", lossless: false },
    eac3: { tag: "eac3", lossless: false },
    mp2: { tag: "mp2", lossless: false },
    wmav1: { tag: "wma", lossless: false },
    wmav2: { tag: "wma", lossless: false },
    wmapro: { tag: "wma", lossless: false },
    wmalossless: { tag: "wma", lossless: true },
    flac: { tag: "flac", lossless: true },
    alac: { tag: "alac", lossless: true },
    ape: { tag: "ape", lossless: true },
    wavpack: { tag: "wavpack", lossless: true },
    tta: { tag: "tta", lossless: true },
    tak: { tag: "tak", lossless: true },
    truehd: { tag: "truehd", lossless: true },
    mlp: { tag: "mlp", lossless: true },
    dts: { tag: "dts", lossless: null },
  };

const TAG_NAMES = Object.fromEntries(
  Object.entries(AUDIO_CODECS).map(([name, { tag }]) => [name, tag]),
);

/**
 * What a codec is: its tag, whether it keeps every sample, and whether its
 * samples are floating point, whose bit depth says nothing of the source's.
 */
function audioCodec(
  raw: string,
): { tag: string; lossless: boolean | null; float: boolean } | null {
  if (raw.startsWith("pcm_")) {
    // G.711 (telephone) PCM is 8-bit companded: not lossless in any useful
    // sense, nor lossy as a codec is, so it gets no quality.
    const companded = raw === "pcm_mulaw" || raw === "pcm_alaw";
    return {
      tag: "pcm",
      lossless: companded ? null : true,
      float: raw.startsWith("pcm_f"),
    };
  }
  if (raw.startsWith("dsd_"))
    return { tag: "dsd", lossless: true, float: false };
  const tag = codecTagName(raw, TAG_NAMES);
  if (tag === null) return null;
  return { tag, lossless: AUDIO_CODECS[raw]?.lossless ?? null, float: false };
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

/** A band of ten (`120-129`) for a BPM, or null when it is not one. */
export function bpmBand(raw: string): string | null {
  if (!/^\s*\d+(\.\d+)?\s*$/.test(raw)) return null;
  const bpm = Math.round(Number(raw));
  if (!(bpm > 0 && bpm <= 400)) return null;
  const low = Math.floor(bpm / 10) * 10;
  return `${low}-${low + 9}`;
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

type Key = { name: string; camelot: string };

/**
 * A written key as a musical name and its Camelot code, or null. Understands
 * names (`Am`, `A minor`, `F#m`, `Abm`, `C`, `Cmaj`), Camelot (`8A`) and Open
 * Key (`1m`, `1d`), and those written together, as Mixed In Key can
 * (`8A - Am`, `8A/Am`) when every part names the same key.
 */
export function parseKey(raw: string): Key | null {
  const parts = raw.split(/\s*[-/|,]\s*/).filter((p) => p.trim() !== "");
  if (parts.length < 2) return parseOneKey(raw);
  const keys = parts.map(parseOneKey);
  const [firstKey] = keys;
  return firstKey !== null &&
    keys.every((k) => k !== null && k.camelot === firstKey.camelot)
    ? firstKey
    : null;
}

function parseOneKey(raw: string): Key | null {
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
const MAX_GENRES = 4;

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
 * The derived tags of one audio file, from its stored probe output and its
 * duration column. Never throws: an unusable input gives no tag.
 */
export function audioMetaTagsFor(
  raw: unknown,
  duration: number | null,
): DerivedTag[] {
  const out: DerivedTag[] = [];
  if (duration != null && duration > 0)
    out.push({ namespace: "dur", name: durationClass(duration) });
  const probe = raw as Probe | null;
  const stream = Array.isArray(probe?.streams)
    ? probe.streams.find((s) => s?.codec_type === "audio")
    : undefined;
  if (!probe || !stream) return out;

  const codec = audioCodec(
    typeof stream.codec_name === "string"
      ? stream.codec_name.trim().toLowerCase()
      : "",
  );
  if (codec) out.push({ namespace: "codec", name: codec.tag });
  if (codec && codec.lossless !== null) {
    out.push({
      namespace: "audio_quality",
      name: codec.lossless ? "lossless" : "lossy",
    });
    const rate = positiveInt(stream.sample_rate);
    const bits = codec.float
      ? null
      : (positiveInt(stream.bits_per_raw_sample) ??
        positiveInt(stream.bits_per_sample));
    if (codec.lossless && ((rate ?? 0) > 48_000 || (bits ?? 0) > 16))
      out.push({ namespace: "audio_quality", name: "hires" });
  }

  const channels = positiveInt(stream.channels);
  if (channels !== null)
    out.push({
      namespace: "audio_ch",
      name: channels === 1 ? "mono" : channels === 2 ? "stereo" : "surround",
    });

  const tags = embeddedTags(probe, stream);
  const band = firstParsed(tags, ["tbpm", "bpm", "tmpo"], bpmBand);
  if (band) out.push({ namespace: "audio_bpm", name: band });
  const parsed = firstParsed(
    tags,
    ["tkey", "initialkey", "initial key", "key"],
    parseKey,
  );
  if (parsed) {
    out.push({ namespace: "audio_key", name: parsed.name });
    out.push({ namespace: "audio_camelot", name: parsed.camelot });
  }
  const genres = firstParsed(tags, ["genre", "tcon"], (raw) => {
    const found = genreNames(raw);
    return found.length > 0 ? found : null;
  });
  for (const name of genres ?? []) out.push({ namespace: "audio_genre", name });
  return out;
}
