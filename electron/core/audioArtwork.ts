import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DB } from "./db.js";

const manifestSchema = z.object({
  version: z.literal(1),
  albums: z
    .array(
      z.object({
        image: z.string().regex(/^[^/\\]+\.(?:jpe?g|png)$/i),
        tracks: z
          .array(
            z.object({
              path: z
                .string()
                .min(1)
                .transform((relative) =>
                  path.sep === "\\" ? relative.replaceAll("/", "\\") : relative,
                ),
              durationSeconds: z.number().int().positive(),
            }),
          )
          .min(1)
          .max(1000),
      }),
    )
    .min(1)
    .max(250),
});

async function readImportFile(file: string, maxBytes: number): Promise<Buffer> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > maxBytes) {
    throw new Error(`Invalid or oversized import file: ${path.basename(file)}`);
  }
  const bytes = await fs.readFile(file);
  if (bytes.length > maxBytes) {
    throw new Error(`Oversized import file: ${path.basename(file)}`);
  }
  return bytes;
}

type ArtworkTrack = {
  path: string;
  durationSeconds: number;
};

type Cover = { tracks: ArtworkTrack[]; png: Buffer };

export async function importAudioArtwork(
  db: DB,
  manifestPath: string,
  normalizeImage: (bytes: Buffer) => Buffer | null,
): Promise<{ changedKeys: string[]; matched: number; skipped: number }> {
  const manifest = manifestSchema.parse(
    JSON.parse((await readImportFile(manifestPath, 1024 * 1024)).toString()),
  );
  const paths = new Set<string>();
  const covers: Cover[] = [];
  let coverBytes = 0;
  for (const { image, tracks } of manifest.albums) {
    for (const track of tracks) {
      if (paths.has(track.path)) {
        throw new Error(`Duplicate track in cover import: ${track.path}`);
      }
      paths.add(track.path);
    }
    const file = path.join(path.dirname(manifestPath), image);
    const png = normalizeImage(await readImportFile(file, 2 * 1024 * 1024));
    if (!png) throw new Error(`Could not read the cover image: ${image}`);
    coverBytes += png.length;
    if (coverBytes > 32 * 1024 * 1024) {
      throw new Error("This cover import is too large. Split it into batches.");
    }
    covers.push({ tracks, png });
  }

  return applyAudioArtwork(db, covers);
}

function applyAudioArtwork(
  db: DB,
  covers: readonly Cover[],
): { changedKeys: string[]; matched: number; skipped: number } {
  const readTrack = db.prepare(`
    SELECT meta_key AS metaKey FROM files
    WHERE rel_path = ? AND kind = 'audio' AND deleted_at IS NULL
      AND thumb_status = 'done' AND thumb_path IS NULL
      AND content_hash IS NOT NULL AND ABS(duration - ?) <= 1
  `);
  const saveImage = db.prepare(
    "INSERT OR IGNORE INTO lib.audio_artwork_images VALUES (?, ?)",
  );
  const saveCover = db.prepare(`
    INSERT INTO lib.audio_artwork (meta_key, image_hash) VALUES (?, ?)
    ON CONFLICT(meta_key) DO UPDATE SET image_hash = excluded.image_hash
    WHERE audio_artwork.image_hash <> excluded.image_hash
  `);

  return db.transaction(() => {
    const assignments = new Map<string, string>();
    const changedKeys: string[] = [];
    let matched = 0;
    let requested = 0;
    for (const { tracks, png } of covers) {
      const imageHash = createHash("sha256").update(png).digest("hex");
      requested += tracks.length;
      for (const track of tracks) {
        const file = readTrack.get(track.path, track.durationSeconds) as
          { metaKey: string } | undefined;
        if (!file) continue;
        matched++;
        const previous = assignments.get(file.metaKey);
        if (previous && previous !== imageHash) {
          throw new Error(
            `Conflicting covers for the same audio: ${track.path}`,
          );
        }
        if (previous) continue;
        assignments.set(file.metaKey, imageHash);
        saveImage.run(imageHash, png);
        if (saveCover.run(file.metaKey, imageHash).changes)
          changedKeys.push(file.metaKey);
      }
    }
    db.exec(
      "DELETE FROM lib.audio_artwork_images WHERE image_hash NOT IN (SELECT image_hash FROM lib.audio_artwork)",
    );
    return { changedKeys, matched, skipped: requested - matched };
  })();
}

export function audioArtworkFor(
  db: DB,
  fileId: number,
): { imageHash: string; png: Buffer } | null {
  const row = db
    .prepare(
      `
      SELECT i.image_hash AS imageHash, i.png FROM files f
      JOIN lib.audio_artwork a ON a.meta_key = f.meta_key
      JOIN lib.audio_artwork_images i ON i.image_hash = a.image_hash
      WHERE f.id = ? AND f.kind = 'audio' AND f.deleted_at IS NULL
        AND f.thumb_status = 'done' AND f.thumb_path IS NULL
    `,
    )
    .get(fileId) as { imageHash: string; png: Buffer } | undefined;
  return row ?? null;
}
