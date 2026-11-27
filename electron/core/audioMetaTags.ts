// Derived tags for audio files (#468), from the ffprobe output the scan stores
// in `files.meta`, as shared/audioInfo.ts reads it: the audio stream's codec,
// sample rate, bit depth and channels, and the BPM, key and genre a tagger or
// DJ software wrote into the file. No file is read again.
//
// Pure, like autoMetaTagsFor: a value that cannot be read gives no tag, never
// a guessed one.
import { audioInfo, channelClass, tempoClass } from "../../shared/audioInfo.js";
import type { DerivedTag } from "./autoMetaTags.js";
import { codecTagName, durationClass } from "./derivedTagClasses.js";

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

/** What a codec is: its tag, and whether it keeps every sample. */
function audioCodec(
  raw: string,
): { tag: string; lossless: boolean | null } | null {
  if (raw.startsWith("pcm_")) {
    // G.711 (telephone) PCM is 8-bit companded: not lossless in any useful
    // sense, nor lossy as a codec is, so it gets no quality.
    const companded = raw === "pcm_mulaw" || raw === "pcm_alaw";
    return { tag: "pcm", lossless: companded ? null : true };
  }
  if (raw.startsWith("dsd_")) return { tag: "dsd", lossless: true };
  const tag = codecTagName(raw, TAG_NAMES);
  if (tag === null) return null;
  return { tag, lossless: AUDIO_CODECS[raw]?.lossless ?? null };
}

/** The band of ten (`120-129`) a BPM falls in. */
export function bpmBand(bpm: number): string {
  const low = Math.floor(Math.round(bpm) / 10) * 10;
  return `${low}-${low + 9}`;
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
  const info = audioInfo(raw);
  if (!info) return out;

  const codec = audioCodec(info.codec);
  if (codec) out.push({ namespace: "codec", name: codec.tag });
  if (codec && codec.lossless !== null) {
    out.push({
      namespace: "audio_quality",
      name: codec.lossless ? "lossless" : "lossy",
    });
    // A float sample's size is no depth (audioInfo leaves it out).
    const bits = info.bits;
    if (codec.lossless && ((info.sampleRate ?? 0) > 48_000 || (bits ?? 0) > 16))
      out.push({ namespace: "audio_quality", name: "hires" });
  }

  if (info.channels !== null)
    out.push({ namespace: "audio_ch", name: channelClass(info.channels) });

  if (info.bpm !== null) {
    out.push({ namespace: "audio_bpm", name: bpmBand(info.bpm) });
    out.push({ namespace: "audio_tempo", name: tempoClass(info.bpm) });
  }
  if (info.key) {
    out.push({ namespace: "audio_key", name: info.key.name });
    out.push({ namespace: "audio_camelot", name: info.key.camelot });
  }
  for (const name of info.genres) out.push({ namespace: "audio_genre", name });
  return out;
}
