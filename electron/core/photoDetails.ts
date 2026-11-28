// What file_photo_details returns for a file id (#725).
import type { DB } from "./db.js";
import { readPhotoDetails } from "./exif.js";
import { isInsideRoot } from "./paths.js";
import { absPathOf } from "./tags.js";
import type { PhotoDetailsResult } from "../../shared/photoInfo.js";

/**
 * A photo's details, or null for a file that is not an image (or not in the
 * index). A path that does not resolve inside the root is not read, and is
 * reported as unreadable rather than as an error: that is what a share that
 * went away looks like (realpath fails), and the detail view says so. Nothing
 * here blocks the event loop on the file system.
 */
export async function photoDetailsOf(
  core: { db: DB; root: string },
  id: number,
): Promise<PhotoDetailsResult | null> {
  const kind = core.db
    .prepare("SELECT kind FROM files WHERE id = ? AND deleted_at IS NULL")
    .pluck()
    .get(id);
  if (kind !== "image") return null;
  const abs = absPathOf(core.db, id);
  if (!abs) return null;
  if (!(await isInsideRoot(abs, core.root))) return { status: "unreadable" };
  return readPhotoDetails(abs);
}
