/**
 * Cap on duplicate groups returned by duplicates_list. Groups are sorted by
 * reclaimable bytes descending, so a truncated result still surfaces the most
 * valuable groups first. Shared so the renderer's "showing top N" notice
 * always matches the actual server-side cut-off.
 */
export const MAX_DUPLICATE_GROUPS = 500;
