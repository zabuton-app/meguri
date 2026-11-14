import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { audioArtworkFor, importAudioArtwork } from "../audioArtwork.js";
import { fileDetail, setThumb } from "../queries.js";
import { insertFile, newSharedDbs } from "./helpers.js";

describe("audio artwork import", () => {
  it("matches tracks by path and duration, reuses covers, and preserves embedded art", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "meguri-artwork-"));
    const { dbs, cleanup } = newSharedDbs(2);
    const [{ db, rootId }, other] = dbs;
    try {
      const seed = (relPath: string, contentHash: string, duration: number) => {
        const id = insertFile(db, rootId, {
          relPath,
          kind: "audio",
          contentHash,
          duration,
        });
        setThumb(db, id, null, "done");
        return id;
      };
      const first = seed("track.wav", "hash-1", 54.1);
      const second = seed("track-2.wav", "hash-2", 108);
      const wrongDuration = seed("instrumental.wav", "hash-3", 27);
      const embedded = seed("embedded.wav", "hash-4", 60);
      setThumb(db, embedded, "embedded.webp", "done");
      const sameRecording = insertFile(other.db, other.rootId, {
        relPath: "copy.wav",
        kind: "audio",
        contentHash: "hash-1",
        duration: 54.1,
      });
      setThumb(other.db, sameRecording, null, "done");

      const manifest = path.join(dir, "covers.json");
      const artwork = Buffer.from("normalized image");
      await fs.writeFile(path.join(dir, "album.jpg"), artwork);
      await fs.writeFile(
        manifest,
        JSON.stringify({
          version: 1,
          albums: [
            {
              image: "album.jpg",
              tracks: [
                { path: "track.wav", durationSeconds: 55 },
                { path: "track-2.wav", durationSeconds: 108 },
                { path: "instrumental.wav", durationSeconds: 34 },
                { path: "embedded.wav", durationSeconds: 60 },
              ],
            },
          ],
        }),
      );
      const apply = () => importAudioArtwork(db, manifest, (bytes) => bytes);
      await expect(apply()).resolves.toEqual({
        changedKeys: ["hash-1", "hash-2"],
        matched: 2,
        skipped: 2,
      });
      expect(fileDetail(db, first)?.hasThumb).toBe(1);
      expect(audioArtworkFor(db, first)?.png).toEqual(artwork);
      expect(audioArtworkFor(other.db, sameRecording)?.png).toEqual(artwork);
      expect(fileDetail(other.db, sameRecording)?.hasThumb).toBe(1);
      expect(audioArtworkFor(db, second)?.imageHash).toBe(
        audioArtworkFor(db, first)?.imageHash,
      );
      expect(audioArtworkFor(db, wrongDuration)).toBeNull();
      expect(audioArtworkFor(db, embedded)).toBeNull();
      await expect(apply()).resolves.toMatchObject({
        changedKeys: [],
        matched: 2,
      });
      db.prepare("DELETE FROM files WHERE id = ?").run(first);
      const reindexed = seed("renamed.wav", "hash-1", 54.1);
      expect(audioArtworkFor(db, reindexed)?.png).toEqual(artwork);
      expect(fileDetail(db, reindexed)?.hasThumb).toBe(1);
    } finally {
      cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
