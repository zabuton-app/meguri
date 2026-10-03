// How a selection's current state reads on the selection bar.
//
// A selection is almost always mixed, so every control has to answer two
// questions before it can be drawn: what would clicking it do, and what does it
// show right now. Both are decided here, away from the component, because the
// answers are the feature's actual rules.
import type { FileRow } from "@/ipc/types";
import type { BulkTargets } from "@shared/ipc/channels";
import { MAX_BULK_FILES } from "@shared/tags";

/**
 * Selection rows regrouped into the per-workspace targets every bulk channel
 * takes. A file id only means something inside its own database, so the "All"
 * view and collections routinely produce several groups.
 */
export function bulkTargets(rows: FileRow[]): BulkTargets {
  return groupBulkTargets(
    rows.map((row) => ({ workspaceId: row.workspaceId, fileId: row.id })),
  );
}

/** The same regrouping for bare `workspaceId + fileId` pairs (a drag payload). */
export function groupBulkTargets(
  files: { workspaceId: string; fileId: number }[],
): BulkTargets {
  const groups = new Map<string, number[]>();
  for (const { workspaceId, fileId } of files) {
    const ids = groups.get(workspaceId);
    if (ids) ids.push(fileId);
    else groups.set(workspaceId, [fileId]);
  }
  return [...groups].map(([workspaceId, fileIds]) => ({
    workspaceId,
    fileIds,
  }));
}

/**
 * Read rows again through a bulk channel, however many there are.
 *
 * One call may name MAX_BULK_FILES files at most. An edit is refused past
 * that, but a selection is free to grow beyond it — while a write is still
 * pending, among other times — and the read that follows the write covers the
 * selection as it then is. So the rows go out in runs of the cap, one after
 * another.
 *
 * All of the runs or nothing: the caller reads a row that is missing from the
 * answer as a file that is gone, which a run that failed must never look like.
 */
export async function readInBulkBatches(
  rows: FileRow[],
  read: (targets: BulkTargets) => Promise<FileRow[]>,
): Promise<FileRow[]> {
  const out: FileRow[] = [];
  for (let i = 0; i < rows.length; i += MAX_BULK_FILES) {
    const found = await read(bulkTargets(rows.slice(i, i + MAX_BULK_FILES)));
    for (const row of found) out.push(row);
  }
  return out;
}

/** A flag across the selection: on for all of it, some of it, or none. */
export type BulkFlag = "all" | "some" | "none";

/** A flag's state across the selection, with the counts the bar shows for "some". */
export interface BulkFlagState {
  flag: BulkFlag;
  /** Rows the flag is on for. */
  on: number;
  total: number;
}

export function bulkFlagOf(
  rows: FileRow[],
  isOn: (row: FileRow) => boolean,
): BulkFlagState {
  let on = 0;
  for (const row of rows) if (isOn(row)) on++;
  const flag: BulkFlag =
    rows.length === 0 || on === 0
      ? "none"
      : on === rows.length
        ? "all"
        : "some";
  return { flag, on, total: rows.length };
}

/**
 * What a toggle should apply next.
 *
 * A mixed selection levels up rather than down: the user reached for the
 * control to put the whole selection in a state, and clearing the few that
 * already had it would be a surprising way to start. Only a selection that is
 * already uniformly on turns off.
 */
export function bulkToggleTarget(flag: BulkFlag): boolean {
  return flag !== "all";
}

/**
 * The rating every selected file shares, or null when they disagree.
 *
 * Null is what the bar draws as "mixed": showing one file's stars for a
 * selection that does not agree on them would claim a value the selection does
 * not have.
 *
 * A mixed selection therefore has no star to click twice, which is how the
 * per-file control clears a rating — the bar gives it its own clear button
 * instead.
 */
export function uniformRating(rows: FileRow[]): number | null {
  if (rows.length === 0) return 0;
  const first = rows[0].rating;
  return rows.every((row) => row.rating === first) ? first : null;
}
