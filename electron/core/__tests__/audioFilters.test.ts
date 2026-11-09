import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { insertFile, newDb } from "./helpers.js";
import { openDb, type DB } from "../db.js";
import {
  searchFiles,
  updateExtractedMeta,
  upsertScanRoot,
  setRating,
} from "../queries.js";
import { searchWorkspaces } from "../crossWorkspace.js";
import type { Core } from "../index.js";
import type { SearchQuery } from "../types.js";
import { readAudioMetadata } from "../../../shared/audioMetadata.js";
import { SearchQuerySchema } from "../../../shared/ipc/schema.js";

const raw = (rate = 96000, bits = 24, channels = 2) => ({
  streams: [
    {
      codec_type: "video",
      sample_rate: "1",
      bits_per_raw_sample: "8",
      width: 640,
      height: 480,
    },
    {
      codec_type: "audio",
      sample_rate: String(rate),
      bits_per_raw_sample: String(bits),
      bits_per_sample: 32,
      channels,
      bit_rate: String(rate * bits * channels),
    },
  ],
});

describe("audio properties", () => {
  it("reads the audio stream and source precision, not cover art or decoder storage", () => {
    expect(readAudioMetadata(raw())).toEqual({
      sampleRate: 96000,
      bitDepth: 24,
      channels: 2,
      bitRate: 4608000,
    });
    expect(
      readAudioMetadata({
        streams: [
          {
            codec_type: "audio",
            sample_fmt: "fltp",
            bits_per_sample: 0,
            sample_rate: "48000",
            channels: 1,
          },
        ],
      }),
    ).toEqual({
      sampleRate: 48000,
      bitDepth: null,
      channels: 1,
      bitRate: null,
    });
    expect(readAudioMetadata("not JSON").sampleRate).toBeNull();
    expect(
      readAudioMetadata({
        streams: [{ codec_type: "audio", sample_rate: "N/A", channels: -1 }],
      }).channels,
    ).toBeNull();
  });

  it("repairs stale audio/resolution pairs at the IPC and saved-search boundary", () => {
    expect(
      SearchQuerySchema.parse({
        kind: "audio",
        resolution: { preset: "qhd", match: "exact" },
        audio: { sampleRate: 96000 },
      }),
    ).toEqual({ kind: "audio", audio: { sampleRate: 96000 } });
    expect(
      SearchQuerySchema.parse({ kind: "video", audio: { sampleRate: 96000 } }),
    ).toEqual({ kind: "video" });
    expect(
      SearchQuerySchema.safeParse({ kind: "audio", audio: { durationMin: -1 } })
        .success,
    ).toBe(false);
  });
});

describe("audio catalogue filtering", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => ({ db, rootId } = newDb()));
  afterEach(() => db.close());

  function add(
    database: DB,
    root: number,
    name: string,
    rate: number,
    bits: number,
    channels: number,
  ) {
    const id = insertFile(database, root, { relPath: name, kind: "audio" });
    updateExtractedMeta(database, id, {
      width: null,
      height: null,
      duration: 12,
      codec: "pcm_s24le",
      fps: null,
      capturedAt: null,
      raw: raw(rate, bits, channels),
    });
    return id;
  }
  function names(audio: SearchQuery["audio"]) {
    return searchFiles(db, { kind: "audio", audio })
      .items.map((f) => f.relPath)
      .sort();
  }

  it("matches sample rate and bit depth independently as exact values or lower bounds", () => {
    add(db, rootId, "base.wav", 96000, 24, 2);
    add(db, rootId, "higher.wav", 192000, 32, 2);
    add(db, rootId, "rate.wav", 192000, 24, 2);
    add(db, rootId, "bits.wav", 96000, 32, 2);
    add(db, rootId, "low.wav", 48000, 16, 2);
    expect(names({ sampleRate: 96000, bitDepth: 24 })).toEqual(["base.wav"]);
    expect(
      names({
        sampleRate: 96000,
        sampleRateMatch: "atLeast",
        bitDepth: 24,
        bitDepthMatch: "atLeast",
      }),
    ).toEqual(["base.wav", "bits.wav", "higher.wav", "rate.wav"]);
    expect(
      names({ sampleRate: 96000, sampleRateMatch: "atLeast", bitDepth: 24 }),
    ).toEqual(["base.wav", "rate.wav"]);
    expect(
      names({ sampleRate: 96000, bitDepth: 24, bitDepthMatch: "atLeast" }),
    ).toEqual(["base.wav", "bits.wav"]);
  });

  it("combines sample rate, precision, mono/stereo, codec, bitrate and duration", () => {
    add(db, rootId, "stereo.wav", 96000, 24, 2);
    add(db, rootId, "mono.wav", 48000, 16, 1);
    add(db, rootId, "surround.wav", 96000, 24, 6);
    insertFile(db, rootId, { relPath: "unknown.mp3", kind: "audio" });
    expect(
      names({
        sampleRate: 96000,
        bitDepth: 24,
        channels: "stereo",
        codec: "pcm",
        durationMin: 10,
        durationMax: 20,
        bitRateMin: 1000000,
      }),
    ).toEqual(["stereo.wav"]);
    expect(names({ channels: "mono" })).toEqual(["mono.wav"]);
    expect(names({ channels: "multichannel" })).toEqual(["surround.wav"]);
    expect(names({ durationMax: 11 })).toEqual([]);
    expect(names({ bitDepth: 32 })).toEqual([]);
    expect(
      searchFiles(db, {
        kind: "audio",
        resolution: { preset: "uhd", match: "exact" },
      }).items,
    ).toHaveLength(4);
  });

  it("combines audio properties and ratings across scanned folders", () => {
    const other = newDb();
    try {
      setRating(db, add(db, rootId, "a.wav", 96000, 24, 2), 4);
      setRating(
        other.db,
        add(other.db, other.rootId, "b.wav", 96000, 24, 2),
        5,
      );
      add(other.db, other.rootId, "low.wav", 48000, 16, 1);
      expect(
        searchWorkspaces(
          [
            { id: "a", core: { db } as Core },
            { id: "b", core: { db: other.db } as Core },
          ],
          {
            kind: "audio",
            audio: { sampleRate: 96000 },
            ratingMin: 4,
            sort: "name",
          },
        ).items.map((f) => f.relPath),
      ).toEqual(["a.wav", "b.wav"]);
    } finally {
      other.db.close();
    }
  });
});

it("backfills an existing catalogue from stored probe metadata without touching ratings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-audio-db-"));
  const file = path.join(dir, "db.sqlite");
  try {
    let db = openDb(file);
    const root = upsertScanRoot(db, "/audio", "audio");
    const id = insertFile(db, root, { relPath: "old.wav", kind: "audio" });
    db.prepare("UPDATE files SET meta = ? WHERE id = ?").run(
      JSON.stringify(raw()),
      id,
    );
    setRating(db, id, 5);
    db.exec("DROP INDEX idx_files_audio");
    for (const column of [
      "sample_rate",
      "bit_depth",
      "audio_channels",
      "audio_bit_rate",
    ])
      db.exec(`ALTER TABLE files DROP COLUMN ${column}`);
    db.close();
    db = openDb(file);
    expect(
      searchFiles(db, {
        kind: "audio",
        audio: { sampleRate: 96000, bitDepth: 24, channels: "stereo" },
      }).items[0]?.rating,
    ).toBe(5);
    db.close();
    db = openDb(file);
    expect(
      searchFiles(db, { kind: "audio", audio: { sampleRate: 96000 } }).items,
    ).toHaveLength(1);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
