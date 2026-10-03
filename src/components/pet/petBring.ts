// "Bring me something": the pet draws a category at random (weighted), then
// one file from it through files_random. Empty categories are skipped, so it
// comes back empty-handed only when every category is.
import type { FileRow, SearchQuery, UserCollectionItem } from "@/ipc/types";
import { queueKey } from "@/lib/playbackQueue";

export type BringCategory = "watchLater" | "inProgress" | "liked" | "unplayed";

/** Relative odds of each category being tried first. */
export const BRING_WEIGHTS: Readonly<Record<BringCategory, number>> = {
  watchLater: 4,
  inProgress: 3,
  liked: 2,
  unplayed: 2,
};

/** Rating from which a file counts as highly rated. */
const LIKED_RATING_MIN = 4;
/** Most Watch Later ids sent as one filter. */
const WATCH_LATER_CHUNK = 500;
/** Rows asked for per chunk: the most files_random returns. */
const WATCH_LATER_SAMPLE = 500;

export interface Brought {
  category: BringCategory;
  file: FileRow;
}

type Random = () => number;
type FilesRandom = (query: SearchQuery) => Promise<FileRow[]>;

/** Every category, in a weighted random order (no category twice). */
export function drawOrder(
  weights: Readonly<Record<BringCategory, number>> = BRING_WEIGHTS,
  rng: Random = Math.random,
): BringCategory[] {
  const left = Object.entries(weights) as [BringCategory, number][];
  const order: BringCategory[] = [];
  while (left.length > 0) {
    const total = left.reduce((sum, [, w]) => sum + w, 0);
    let roll = rng() * total;
    let pick = left.length - 1;
    for (let i = 0; i < left.length; i++) {
      roll -= left[i][1];
      if (roll < 0) {
        pick = i;
        break;
      }
    }
    order.push(left[pick][0]);
    left.splice(pick, 1);
  }
  return order;
}

async function first(
  filesRandom: FilesRandom,
  query: SearchQuery,
): Promise<FileRow | null> {
  const rows = await filesRandom({ ...query, limit: 1 });
  return rows[0] ?? null;
}

function shuffled<T>(items: readonly T[], rng: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * An unplayed Watch Later item within the active scope. The id filter is not
 * exact on its own: file ids are only unique within a workspace, so under
 * "All" it also matches other workspaces' files, and while a collection is
 * the scope the draw is over that collection's files. Either way only true
 * members are kept, and every chunk of the queue is tried (in random order)
 * before the category counts as empty.
 */
async function fromWatchLater(
  filesRandom: FilesRandom,
  items: readonly UserCollectionItem[],
  rng: Random,
): Promise<FileRow | null> {
  if (items.length === 0) return null;
  const members = new Set(items.map(queueKey));
  const ids = shuffled([...new Set(items.map((i) => i.fileId))], rng);
  for (let at = 0; at < ids.length; at += WATCH_LATER_CHUNK) {
    const rows = await filesRandom({
      fileIds: ids.slice(at, at + WATCH_LATER_CHUNK),
      played: false,
      limit: WATCH_LATER_SAMPLE,
    });
    const hit = rows.find((r) =>
      members.has(queueKey({ workspaceId: r.workspaceId, fileId: r.id })),
    );
    if (hit) return hit;
  }
  return null;
}

async function fromCategory(
  category: BringCategory,
  filesRandom: FilesRandom,
  watchLater: readonly UserCollectionItem[],
  rng: Random,
): Promise<FileRow | null> {
  switch (category) {
    case "watchLater":
      return fromWatchLater(filesRandom, watchLater, rng);
    case "inProgress":
      return first(filesRandom, { inProgress: true });
    case "liked": {
      const queries: SearchQuery[] = [
        { favorite: true },
        { ratingMin: LIKED_RATING_MIN },
      ];
      if (rng() < 0.5) queries.reverse();
      return (
        (await first(filesRandom, queries[0])) ??
        (await first(filesRandom, queries[1]))
      );
    }
    case "unplayed":
      return first(filesRandom, { played: false });
  }
}

/**
 * One file and the category it came from, or null when there is nothing to
 * bring. files_random draws from the active scope, so under "All" this picks
 * across all workspaces.
 */
export async function bringSomething({
  filesRandom,
  watchLater,
  rng = Math.random,
}: {
  filesRandom: FilesRandom;
  watchLater: readonly UserCollectionItem[];
  rng?: Random;
}): Promise<Brought | null> {
  for (const category of drawOrder(BRING_WEIGHTS, rng)) {
    const file = await fromCategory(category, filesRandom, watchLater, rng);
    if (file) return { category, file };
  }
  return null;
}
