export const REMUX_CONTAINERS = new Set(["mkv", "avi", "wmv", "flv", "ts"]);
export const PREVIEW_AUDIO_TRACK_PARAM = "audioTrack";
export const DEFAULT_AUDIO_TRACK = -1;

interface Stream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  disposition?: { attached_pic?: number; default?: number };
  tags?: { title?: string; handler_name?: string; language?: string };
}

function streams(raw: unknown): Stream[] {
  try {
    const data = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
      streams?: Stream[];
    } | null;
    return Array.isArray(data?.streams) ? data.streams.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export interface PlaybackTrack {
  title: string;
  language: string;
  codec: string;
}

export function readAudioTracks(raw: unknown): PlaybackTrack[] {
  return streams(raw)
    .filter((stream) => stream.codec_type === "audio")
    .map((stream) => {
      const title = stream.tags?.title ?? stream.tags?.handler_name;
      const language = stream.tags?.language;
      return {
        title:
          typeof title === "string" && title !== "SoundHandler"
            ? title.trim()
            : "",
        language:
          typeof language === "string" && language !== "und"
            ? language.trim()
            : "",
        codec: typeof stream.codec_name === "string" ? stream.codec_name : "",
      };
    });
}

/**
 * For ordinary video streams with packets, FFmpeg prefers default disposition,
 * then the largest picture, then input order. Probe metadata does not expose
 * FFmpeg's packet-availability flags, so unusual inputs can differ.
 */
export function remuxVideoIndex(raw: unknown): number | undefined {
  return streams(raw)
    .filter(
      (s) =>
        s.codec_type === "video" &&
        !s.disposition?.attached_pic &&
        Number.isSafeInteger(s.index),
    )
    .sort(
      (a, b) =>
        Number(!!b.disposition?.default) - Number(!!a.disposition?.default) ||
        (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) ||
        a.index! - b.index!,
    )[0]?.index;
}

export function isRemuxedVideo(
  codec: string | null,
  ext: string | null,
): boolean {
  return codec === "prores" || REMUX_CONTAINERS.has(ext?.toLowerCase() ?? "");
}
