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

// Video codecs the built-in player decodes, checked in the built app (#294).
// HEVC decodes only where the platform has a decoder (not on Linux); it is
// left as it is for now.
const PLAYABLE_VIDEO_CODECS = new Set(["h264", "hevc", "vp8", "vp9", "av1"]);

/**
 * Whether a video plays through an H.264 preview the media server encodes:
 * any codec the player cannot decode, such as ProRes, MPEG-4 Part 2 or MJPEG.
 * An unknown codec (not probed yet) keeps the direct or copy path.
 */
export function needsVideoPreview(codec: string | null | undefined): boolean {
  return !!codec && !PLAYABLE_VIDEO_CODECS.has(codec);
}

export function isRemuxedVideo(
  codec: string | null,
  ext: string | null,
): boolean {
  return (
    needsVideoPreview(codec) || REMUX_CONTAINERS.has(ext?.toLowerCase() ?? "")
  );
}
