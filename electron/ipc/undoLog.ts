// What each apply of the auto-tagging screen attached, so it can be taken back
// exactly — nothing the files already had. The screen sends one apply as
// several calls when it is large, and when a later one fails it takes the
// earlier ones back with these, rather than leave the files half tagged. That
// is their only use: in memory on purpose, a rollback, not a history.
import type { TagPair } from "../core/autoTag.js";

export type UndoEntry = { workspaceId: string; pairs: TagPair[] }[];

/** Rollback handles kept at a time; the oldest go first. */
const MAX_UNDO_ENTRIES = 256;
/** Pairs those handles may hold together, so a long session stays bounded. */
const MAX_UNDO_PAIRS = 500_000;

export class UndoLog {
  private readonly entries = new Map<string, UndoEntry>();
  private pairs = 0;

  constructor(
    private readonly maxEntries = MAX_UNDO_ENTRIES,
    private readonly maxPairs = MAX_UNDO_PAIRS,
  ) {}

  /**
   * Keep `entry` under `id`, then forget the oldest handles until the rest
   * fit the bounds. `keep` (the earlier calls of the same apply, which its
   * failure would take back) and `id` itself are never forgotten here.
   */
  add(id: string, entry: UndoEntry, keep: readonly string[] = []): void {
    this.entries.set(id, entry);
    this.pairs += count(entry);
    const kept = new Set([...keep, id]);
    for (const old of [...this.entries.keys()]) {
      if (this.entries.size <= this.maxEntries && this.pairs <= this.maxPairs) {
        break;
      }
      if (!kept.has(old)) this.forget(old);
    }
  }

  /** Take the entry out, to undo it; undefined when it is not kept. */
  forget(id: string): UndoEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    this.pairs -= count(entry);
    return entry;
  }
}

function count(entry: UndoEntry): number {
  return entry.reduce((n, { pairs }) => n + pairs.length, 0);
}
