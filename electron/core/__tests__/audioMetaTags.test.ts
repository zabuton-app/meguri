// Derived tags for audio files (#468): the rules over stored probe output,
// real files probed with the bundled ffprobe (so the tag names it reports are
// the ones the rules read), and the backfill reading `files.meta`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { audioMetaTagsFor, bpmBand } from "../audioMetaTags.js";
import {
  genreNames,
  parseBpm,
  parseKey,
  tempoClass,
} from "../../../shared/audioInfo.js";
import { autoMetaTagsFor, backfillAutoMetaTags } from "../autoMetaTags.js";
import { FFMPEG } from "../ffmpeg-paths.js";
import { extractMeta } from "../media.js";
import { fileTags } from "../tags.js";
import type { DB } from "../db.js";
import { AUTO_META_VALUES } from "../../../shared/tags.js";
import { insertFile, newDb } from "./helpers.js";

/** Qualified names, sorted. */
const names = (tags: { namespace: string; name: string }[]) =>
  tags.map((t) => `${t.namespace}:${t.name}`).sort();

/** Probe output with one audio stream. */
const probe = (
  stream: Record<string, unknown>,
  formatTags?: Record<string, string>,
) => ({
  streams: [{ codec_type: "audio", ...stream }],
  format: formatTags ? { tags: formatTags } : {},
});

describe("parseBpm and bpmBand", () => {
  it("reads a BPM to a tenth, and puts it in its band of ten", () => {
    expect(parseBpm("128")).toBe(128);
    expect(parseBpm(" 96.55 ")).toBe(96.6);
    expect(bpmBand(128)).toBe("120-129");
    expect(bpmBand(129.6)).toBe("130-139");
    expect(bpmBand(96.5)).toBe("90-99");
    expect(bpmBand(5)).toBe("0-9");
  });

  it("gives nothing for what is not a BPM", () => {
    for (const raw of ["", "0", "-120", "401", "fast", "120bpm", "1e3"])
      expect(parseBpm(raw)).toBeNull();
  });
});

describe("tempoClass", () => {
  it("calls a BPM slow under 90 and fast from 120", () => {
    expect(tempoClass(89.9)).toBe("slow");
    expect(tempoClass(90)).toBe("moderate");
    expect(tempoClass(119.9)).toBe("moderate");
    expect(tempoClass(120)).toBe("fast");
  });

  it("gives a file its tempo beside its band", () => {
    expect(
      names(
        audioMetaTagsFor(probe({ codec_name: "mp3" }, { TBPM: "85" }), null),
      ).filter((t) => t.startsWith("audio_tempo") || t.startsWith("audio_bpm")),
    ).toEqual(["audio_bpm:80-89", "audio_tempo:slow"]);
  });
});

describe("parseKey", () => {
  it("reads names, as the major and minor keys DJ software writes", () => {
    expect(parseKey("Am")).toEqual({ name: "A minor", camelot: "8A" });
    expect(parseKey("A minor")).toEqual({
      name: "A minor",
      camelot: "8A",
    });
    expect(parseKey("C")).toEqual({ name: "C major", camelot: "8B" });
    expect(parseKey("Cmaj")).toEqual({ name: "C major", camelot: "8B" });
    expect(parseKey("F#m")).toEqual({ name: "F# minor", camelot: "11A" });
    expect(parseKey("Abm")).toEqual({ name: "G# minor", camelot: "1A" });
    expect(parseKey("Bb")).toEqual({ name: "Bb major", camelot: "6B" });
    expect(parseKey("D♭")).toEqual({ name: "Db major", camelot: "3B" });
    expect(parseKey("ebm")).toEqual({ name: "Eb minor", camelot: "2A" });
  });

  it("reads Camelot and Open Key codes", () => {
    expect(parseKey("8A")).toEqual({ name: "A minor", camelot: "8A" });
    expect(parseKey("12b")).toEqual({ name: "E major", camelot: "12B" });
    expect(parseKey("1m")).toEqual({ name: "A minor", camelot: "8A" });
    expect(parseKey("1d")).toEqual({ name: "C major", camelot: "8B" });
    expect(parseKey("6d")).toEqual({ name: "B major", camelot: "1B" });
  });

  it("reads a key written twice, as Mixed In Key can, when both agree", () => {
    expect(parseKey("8A - Am")).toEqual({ name: "A minor", camelot: "8A" });
    expect(parseKey("8A/Am")).toEqual({ name: "A minor", camelot: "8A" });
    expect(parseKey("Abm | 1A")).toEqual({ name: "G# minor", camelot: "1A" });
    expect(parseKey("8A - C")).toBeNull();
    expect(parseKey("8A - x")).toBeNull();
  });

  it("gives nothing for what it cannot read", () => {
    for (const raw of ["", "H", "13A", "0B", "A minor/C", "o", "Amaj7"])
      expect(parseKey(raw)).toBeNull();
  });
});

describe("genreNames", () => {
  it("splits several genres, lowercased, once each", () => {
    expect(genreNames("Jazz; Soul/jazz, Funk")).toEqual([
      "jazz",
      "soul",
      "funk",
    ]);
  });

  it("skips numeric ID3v1 codes, keeping a name after one", () => {
    expect(genreNames("(17)")).toEqual([]);
    expect(genreNames("17")).toEqual([]);
    expect(genreNames("(17)Rock")).toEqual(["rock"]);
  });

  it("keeps at most four", () => {
    expect(genreNames("a1;b1;c1;d1;e1")).toEqual(["a1", "b1", "c1", "d1"]);
  });
});

describe("audioMetaTagsFor", () => {
  it("tags the codec, quality, channels and length", () => {
    expect(
      names(
        audioMetaTagsFor(
          probe({ codec_name: "mp3", sample_rate: "44100", channels: 2 }),
          200,
        ),
      ),
    ).toEqual([
      "audio_ch:stereo",
      "audio_quality:lossy",
      "codec:mp3",
      "dur:medium",
    ]);
  });

  it("calls lossless audio above 48 kHz or 16 bit hi-res, never lossy audio", () => {
    const tags = (stream: Record<string, unknown>) =>
      names(audioMetaTagsFor(probe(stream), null));
    expect(
      tags({
        codec_name: "flac",
        sample_rate: "96000",
        bits_per_raw_sample: "16",
      }),
    ).toContain("audio_quality:hires");
    expect(
      tags({
        codec_name: "pcm_s24le",
        sample_rate: "48000",
        bits_per_sample: 24,
      }),
    ).toEqual(["audio_quality:hires", "audio_quality:lossless", "codec:pcm"]);
    expect(
      tags({
        codec_name: "flac",
        sample_rate: "48000",
        bits_per_raw_sample: "16",
      }),
    ).not.toContain("audio_quality:hires");
    expect(tags({ codec_name: "opus", sample_rate: "96000" })).not.toContain(
      "audio_quality:hires",
    );
    // A codec that does not say gets no quality at all.
    expect(tags({ codec_name: "dts", sample_rate: "48000" })).toEqual([
      "codec:dts",
    ]);
  });

  it("gives telephone PCM no quality, and floating-point PCM no hi-res by bit depth", () => {
    const tags = (stream: Record<string, unknown>) =>
      names(audioMetaTagsFor(probe(stream), null));
    expect(tags({ codec_name: "pcm_mulaw", sample_rate: "8000" })).toEqual([
      "codec:pcm",
    ]);
    expect(
      tags({
        codec_name: "pcm_f32le",
        sample_rate: "44100",
        bits_per_sample: 32,
      }),
    ).toEqual(["audio_quality:lossless", "codec:pcm"]);
    expect(
      tags({
        codec_name: "pcm_f32le",
        sample_rate: "96000",
        bits_per_sample: 32,
      }),
    ).toContain("audio_quality:hires");
  });

  it("folds codec names", () => {
    const codec = (name: string) =>
      names(audioMetaTagsFor(probe({ codec_name: name }), null)).filter((t) =>
        t.startsWith("codec:"),
      );
    expect(codec("mp3float")).toEqual(["codec:mp3"]);
    expect(codec("wmav2")).toEqual(["codec:wma"]);
    expect(codec("dsd_lsbf")).toEqual(["codec:dsd"]);
    expect(codec("Not A Codec!")).toEqual([]);
  });

  it("uses the same lengths as videos, so dur:long means one thing", () => {
    const dur = (seconds: number) =>
      names(audioMetaTagsFor(null, seconds)).filter((t) =>
        t.startsWith("dur:"),
      );
    expect(dur(59)).toEqual(["dur:short"]);
    expect(dur(60)).toEqual(["dur:medium"]);
    expect(dur(1800)).toEqual(["dur:medium"]);
    expect(dur(1801)).toEqual(["dur:long"]);
    expect(
      autoMetaTagsFor({
        kind: "video",
        width: null,
        height: null,
        duration: 1801,
        codec: null,
      }),
    ).toEqual([{ namespace: "dur", name: "long" }]);
  });

  it("reads BPM, key and genre from the container or the stream, in any case", () => {
    expect(
      names(
        audioMetaTagsFor(
          probe(
            { codec_name: "aac", tags: { BPM: "999", Genre: "House" } },
            {
              tmpo: "124",
            },
          ),
          null,
        ),
      ),
    ).toEqual([
      "audio_bpm:120-129",
      "audio_genre:house",
      "audio_quality:lossy",
      "audio_tempo:fast",
      "codec:aac",
    ]);
    expect(
      names(
        audioMetaTagsFor(
          probe({ codec_name: "opus", tags: { initialkey: "8A" } }),
          null,
        ),
      ),
    ).toEqual([
      "audio_camelot:8A",
      "audio_key:A minor",
      "audio_quality:lossy",
      "codec:opus",
    ]);
  });

  it("gives what it can when the probe output is broken", () => {
    expect(audioMetaTagsFor({ streams: "x" }, 10)).toEqual([
      { namespace: "dur", name: "short" },
    ]);
    expect(audioMetaTagsFor("not json", null)).toEqual([]);
    expect(
      audioMetaTagsFor({ streams: [{ codec_type: "video" }] }, null),
    ).toEqual([]);
  });

  it("emits nothing outside the declared sets", () => {
    const streams = [
      { codec_name: "flac", sample_rate: "96000", channels: 1 },
      { codec_name: "mp3", channels: 2 },
      { codec_name: "ac3", channels: 6 },
    ];
    for (const stream of streams)
      for (const tag of audioMetaTagsFor(probe(stream), 30)) {
        const declared = AUTO_META_VALUES[tag.namespace];
        if (declared) expect(declared).toContain(tag.name);
      }
  });

  it("is what autoMetaTagsFor gives an audio file", () => {
    expect(
      names(
        autoMetaTagsFor({
          kind: "audio",
          width: null,
          height: null,
          duration: 30,
          codec: "mp3",
          raw: probe({ codec_name: "mp3", channels: 1 }),
        }),
      ),
    ).toEqual([
      "audio_ch:mono",
      "audio_quality:lossy",
      "codec:mp3",
      "dur:short",
    ]);
  });
});

describe("audio files probed with the bundled ffprobe", () => {
  let dir: string;
  const make = (name: string, args: string[]) => {
    const file = path.join(dir, name);
    execFileSync(FFMPEG, [
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=f=440:d=1",
      ...args,
      file,
    ]);
    return file;
  };
  const tagsOf = async (file: string) => {
    const meta = await extractMeta(file, "audio");
    return names(autoMetaTagsFor({ kind: "audio", ...meta }));
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-audio-tags-"));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("reads ID3 BPM, key and genre from an MP3", async () => {
    const file = make("a.mp3", [
      "-id3v2_version",
      "4",
      "-metadata",
      "TBPM=128",
      "-metadata",
      "TKEY=Am",
      "-metadata",
      "genre=Deep House",
    ]);
    expect(await tagsOf(file)).toEqual(
      expect.arrayContaining([
        "audio_bpm:120-129",
        "audio_camelot:8A",
        "codec:mp3",
        "audio_genre:deep house",
        "audio_key:A minor",
        "audio_quality:lossy",
      ]),
    );
  });

  it("reads Vorbis comments from a hi-res FLAC", async () => {
    const file = make("b.flac", [
      "-ar",
      "96000",
      "-sample_fmt",
      "s32",
      "-metadata",
      "BPM=96.5",
      "-metadata",
      "INITIALKEY=8A",
    ]);
    expect(await tagsOf(file)).toEqual(
      expect.arrayContaining([
        "audio_bpm:90-99",
        "audio_camelot:8A",
        "codec:flac",
        "audio_quality:hires",
        "audio_quality:lossless",
      ]),
    );
  });

  it("reads the tags Opus keeps on its stream", async () => {
    const file = make("c.opus", [
      "-c:a",
      "libopus",
      "-metadata",
      "BPM=120",
      "-metadata",
      "INITIALKEY=F#m",
    ]);
    expect(await tagsOf(file)).toEqual(
      expect.arrayContaining([
        "audio_bpm:120-129",
        "audio_camelot:11A",
        "audio_key:F# minor",
      ]),
    );
  });
});

describe("the backfill reads files.meta for audio rows", () => {
  let db: DB;
  afterEach(() => db.close());

  it("tags an audio file from its stored probe output", async () => {
    let rootId: number;
    ({ db, rootId } = newDb());
    const id = insertFile(db, rootId, {
      relPath: "song.flac",
      kind: "audio",
      duration: 240,
      codec: "flac",
    });
    db.prepare("UPDATE files SET meta = ? WHERE id = ?").run(
      JSON.stringify(
        probe(
          { codec_name: "flac", sample_rate: "44100", channels: 2 },
          { BPM: "174", GENRE: "Drum & Bass" },
        ),
      ),
      id,
    );
    // Broken JSON on another row does not stop the pass.
    const broken = insertFile(db, rootId, { relPath: "x.mp3", kind: "audio" });
    db.prepare("UPDATE files SET meta = '{' WHERE id = ?").run(broken);

    await backfillAutoMetaTags(db);

    expect(
      names(fileTags(db, id)).filter((t) => !t.startsWith("dur:")),
    ).toEqual([
      "audio_bpm:170-179",
      "audio_ch:stereo",
      "audio_genre:drum & bass",
      "audio_quality:lossless",
      "audio_tempo:fast",
      "codec:flac",
    ]);
    expect(fileTags(db, broken)).toEqual([]);
  });
});
