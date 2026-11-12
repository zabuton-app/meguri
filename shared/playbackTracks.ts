export const REMUX_CONTAINERS = new Set(["mkv", "avi", "wmv", "flv", "ts"]);
export const PREVIEW_AUDIO_TRACK_PARAM = "audioTrack";
export const DEFAULT_AUDIO_TRACK = -1;

interface Stream {
  index?: number;
  codec_type?: string;
  disposition?: { attached_pic?: number };
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
