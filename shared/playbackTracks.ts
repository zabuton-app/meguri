export const REMUX_CONTAINERS = new Set(["mkv", "avi", "wmv", "flv", "ts"]);
export const PREVIEW_AUDIO_TRACK_PARAM = "audioTrack";
export const DEFAULT_AUDIO_TRACK = -1;

interface Stream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  disposition?: { attached_pic?: number };
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

export function hasRemuxVideo(raw: unknown): boolean {
  return streams(raw).some(
    (stream) =>
      stream.codec_type === "video" &&
      !stream.disposition?.attached_pic &&
      Number.isSafeInteger(stream.index),
  );
}

export function isRemuxedVideo(
  codec: string | null,
  ext: string | null,
): boolean {
  return codec === "prores" || REMUX_CONTAINERS.has(ext?.toLowerCase() ?? "");
}
