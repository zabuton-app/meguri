interface Stream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  disposition?: { attached_pic?: number; default?: number };
}

// Audio codecs the built-in player decodes, both in an MP4 or MOV played
// directly and copied into the fragmented MP4 of a remux. Checked in the
// built app (#294): AC-3, E-AC-3, DTS, TrueHD, ALAC and MP2 play silently or
// fail. Only the PCM forms that played are listed; the MP4 muxer refuses some
// others, such as 8-bit, A-law and µ-law.
const PLAYABLE_AUDIO_CODECS = new Set([
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
  "pcm_s16le",
  "pcm_s16be",
  "pcm_s24le",
  "pcm_f32le",
]);

/** Whether an audio track is converted to AAC for the built-in player. An
 *  unknown codec keeps the direct or copy path. */
export function needsAacAudio(codec: string | undefined): boolean {
  return !!codec && !PLAYABLE_AUDIO_CODECS.has(codec);
}

/** Match the primary video and default audio of a directly played file. */
export function directAacTracks(
  raw: unknown,
): { audio: number; video: number } | undefined {
  let streams: Stream[];
  try {
    const data = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
      streams?: Stream[];
    } | null;
    if (!Array.isArray(data?.streams)) return;
    streams = data.streams.filter(Boolean);
  } catch {
    return;
  }
  const audio = streams.filter((stream) => stream.codec_type === "audio");
  const selectedAudio = Math.max(
    0,
    audio.findIndex((stream) => stream.disposition?.default),
  );
  if (!needsAacAudio(audio[selectedAudio]?.codec_name)) return;
  const videos = streams.filter(
    (stream) =>
      stream.codec_type === "video" && !stream.disposition?.attached_pic,
  );
  const primaryVideo =
    videos.find((stream) => stream.disposition?.default) ?? videos[0];
  const video = primaryVideo?.index;
  if (typeof video !== "number" || !Number.isSafeInteger(video) || video < 0)
    return;
  return { audio: selectedAudio, video };
}
