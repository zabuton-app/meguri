/** Properties of the first audio stream, never the embedded cover picture. */
export interface AudioMetadata {
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  bitRate: number | null;
}

function positive(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function readAudioMetadata(raw: unknown): AudioMetadata {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  const streams = (parsed as { streams?: unknown } | null)?.streams;
  const stream = Array.isArray(streams)
    ? (streams.find(
        (s: unknown) =>
          s &&
          typeof s === "object" &&
          "codec_type" in s &&
          s.codec_type === "audio",
      ) as Record<string, unknown> | undefined)
    : undefined;
  return {
    sampleRate: positive(stream?.sample_rate),
    // Decoder sample_fmt describes decoded storage, not source precision.
    // Lossy formats commonly report zero/unknown: do not invent a bit depth.
    bitDepth:
      positive(stream?.bits_per_raw_sample) ??
      positive(stream?.bits_per_sample),
    channels: positive(stream?.channels),
    bitRate: positive(stream?.bit_rate),
  };
}

export const AUDIO_CODECS = [
  "pcm",
  "flac",
  "alac",
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "wmav2",
] as const;

export function audioCodecLabel(codec: string): string {
  return codec === "wmav2" ? "WMA" : codec.toUpperCase();
}

export function sampleRateLabel(rate: number): string {
  return `${rate / 1000} kHz`;
}
