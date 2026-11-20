import { DATE_RANGES } from "@/lib/dateRanges";
import {
  SmartCollectionSchema,
  type SearchQuery,
  type SmartCollection,
} from "@shared/ipc/schema";
import { ROOT_FOLDER } from "@shared/folderPath";
import { MANUAL_SORT, resolveSortDir } from "@shared/sortDir";
import { parseQualifiedTagName } from "@shared/tags";
import type { Lang, TFunc } from "@/i18n/I18nProvider";
import { formatDate } from "@/lib/dates";
import { kindLabelKey } from "@/lib/mediaKind";
import { SORT_KEYS } from "@/lib/sortLabel";
import { tagHumanLabel } from "@/lib/tagLabel";
import { resolutionLabel } from "@shared/resolutions";

export type { SmartCollection } from "@shared/ipc/schema";

/**
 * Where an earlier version kept the saved searches, and the default one.
 * Read once, to move them into the library (useSmartCollections).
 */
export const SMART_COLLECTIONS_KEY = "meguri.smartCollections.v1";
export const DEFAULT_SMART_COLLECTION_KEY = "meguri.smartCollections.default";

/**
 * The folder a query is scoped to, when that narrows anything: a folder below
 * the root. The root is the whole workspace, so it is no condition at all.
 */
export function scopedFolderPath(query: SearchQuery): string | null {
  const path = query.folder?.path;
  return path != null && path !== ROOT_FOLDER ? path : null;
}

export function cleanSearchQuery(query: SearchQuery): SearchQuery {
  const next: SearchQuery = {};
  if (query.q?.trim()) next.q = query.q.trim();
  if (query.tags?.length) next.tags = query.tags.filter(Boolean);
  if (query.tagSource) next.tagSource = query.tagSource;
  if (query.kind) next.kind = query.kind;
  if (query.resolution && query.kind !== "audio")
    next.resolution = query.resolution;
  if (query.ratingMin != null && query.ratingMin > 0)
    next.ratingMin = query.ratingMin;
  if (query.favorite) next.favorite = true;
  if (query.duplicates) next.duplicates = true;
  if (query.played != null) next.played = query.played;
  if (query.inProgress) next.inProgress = true;
  if (query.playedVia) next.playedVia = query.playedVia;
  for (const { from, to } of DATE_RANGES) {
    if (query[from] != null) next[from] = query[from];
    if (query[to] != null) next[to] = query[to];
  }
  if (query.sort) next.sort = query.sort;
  if (query.sortDir) next.sortDir = query.sortDir;
  // Kept as "everything under it", the way a saved search reopens.
  const folder = scopedFolderPath(query);
  if (folder != null) next.folder = { path: folder, recursive: true };
  return next;
}

/** The saved conditions apart from the folder, which is where a view is. */
export function cleanConditions(query: SearchQuery): SearchQuery {
  const clean = cleanSearchQuery(query);
  delete clean.folder;
  return clean;
}

export function hasSearchConditions(query: SearchQuery): boolean {
  return Object.keys(cleanSearchQuery(query)).length > 0;
}

/**
 * Whether the query narrows the list at all — anything but the sort and the
 * folder. The folder view keys off it: with nothing narrowing, a folder shows
 * its own contents; with a condition, it searches everything below it.
 */
export function hasFilterConditions(query: SearchQuery): boolean {
  const rest = cleanSearchQuery(query);
  delete rest.sort;
  delete rest.sortDir;
  // The folder is where the view is, not what narrows it.
  delete rest.folder;
  return Object.keys(rest).length > 0;
}

/**
 * The saved searches as an earlier version stored them, entry by entry: one
 * that does not validate is left out, not the whole list.
 */
export function parseSmartCollections(raw: string | null): SmartCollection[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    const entry = SmartCollectionSchema.safeParse(item);
    return entry.success ? [entry.data] : [];
  });
}

/**
 * What localStorage holds from an earlier version, or null when it cannot be
 * read: nothing is moved in then, so the move is tried again next launch.
 */
export function readLegacySmartCollections(): {
  collections: SmartCollection[];
  defaultId: string | null;
} | null {
  try {
    return {
      collections: parseSmartCollections(
        localStorage.getItem(SMART_COLLECTIONS_KEY),
      ),
      defaultId: localStorage.getItem(DEFAULT_SMART_COLLECTION_KEY) || null,
    };
  } catch {
    return null;
  }
}

/**
 * The conditions a default saved search applies. Its folder is left out: a
 * folder belongs to one workspace, while the default applies in every one.
 * So is a manual sort, which exists only inside a collection (Home drops it
 * anywhere else, which would leave "Clear all" unable to settle).
 * Null when there is no default, or it points at a deleted collection.
 */
export function defaultQueryOf(
  collections: SmartCollection[],
  defaultId: string | null,
): SearchQuery | null {
  const collection = defaultId
    ? collections.find((c) => c.id === defaultId)
    : undefined;
  if (!collection) return null;
  const query = cleanConditions(collection.query);
  if (query.sort === MANUAL_SORT) {
    delete query.sort;
    delete query.sortDir;
  }
  return query;
}

/**
 * `workspaceId` is the workspace the list shows; it is kept only when the
 * query has a folder, and a folder with no workspace to place it is dropped.
 */
export function makeSmartCollection(
  name: string,
  query: SearchQuery,
  workspaceId?: string | null,
): SmartCollection {
  const now = Math.floor(Date.now() / 1000);
  const cleaned = cleanSearchQuery(query);
  if (cleaned.folder && !workspaceId) delete cleaned.folder;
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
    name: name.trim(),
    query: cleaned,
    ...(cleaned.folder && workspaceId ? { workspaceId } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** Format a Unix-seconds timestamp as a short local date for query descriptions. */
function formatTimestamp(sec: number, lang: Lang): string {
  return formatDate(new Date(sec * 1000), lang);
}

/**
 * Human label for a possibly open-ended date range (Unix seconds). Open ends
 * are spelled out ("From …" / "To …") rather than left as a dangling dash.
 * Exported for the active-filter chips, which show the same ranges.
 */
export function describeDateRange(
  t: TFunc,
  lang: Lang,
  from: number | undefined,
  to: number | undefined,
): string {
  if (from != null && to != null) {
    // One day (a day picked on the heatmap, say) reads as that day.
    const [first, last] = [
      formatTimestamp(from, lang),
      formatTimestamp(to, lang),
    ];
    return first === last ? first : `${first}–${last}`;
  }
  if (from != null)
    return `${t("filter.dateFrom")} ${formatTimestamp(from, lang)}`;
  if (to != null) return `${t("filter.dateTo")} ${formatTimestamp(to, lang)}`;
  return "";
}

export function describeSearchQuery(
  t: TFunc,
  lang: Lang,
  query: SearchQuery,
): string {
  const parts: string[] = [];
  const folder = scopedFolderPath(query);
  if (folder != null) parts.push(`${t("folder.chip")}: ${folder}`);
  if (query.q) parts.push(`"${query.q}"`);
  if (query.kind) {
    const key = kindLabelKey(query.kind);
    parts.push(key ? t(key) : query.kind);
  }
  if (query.ratingMin) parts.push(`★${query.ratingMin}+`);
  if (query.resolution && query.kind !== "audio")
    parts.push(
      `${t(query.resolution.match === "exact" ? "resolution.exact" : "resolution.atLeast")} ${resolutionLabel(query.resolution.preset)}`,
    );
  if (query.favorite) parts.push(t("favorite.chip"));
  if (query.duplicates) parts.push(t("duplicates.chip"));
  if (query.played != null) {
    const label = query.played ? t("filter.played") : t("filter.unplayed");
    parts.push(query.playedVia ? `${label} (${query.playedVia})` : label);
  }
  if (query.inProgress) parts.push(t("filter.inProgress"));
  for (const { label, from, to } of DATE_RANGES) {
    if (query[from] != null || query[to] != null)
      parts.push(
        `${t(label)}: ${describeDateRange(t, lang, query[from], query[to])}`,
      );
  }
  for (const tag of query.tags ?? []) {
    const { namespace, name } = parseQualifiedTagName(tag);
    const label = `${t("media.tags")}: ${tagHumanLabel(t, namespace, name)}`;
    parts.push(query.tagSource ? `${label} (${query.tagSource})` : label);
  }
  if (query.sort || query.sortDir) {
    const sort = query.sort ?? "added";
    const dir = resolveSortDir(sort, query.sortDir);
    // Same key table the filter bar's sort dropdown reads, so a key added there
    // cannot go unlabelled here.
    parts.push(
      `${t(SORT_KEYS[sort] ?? "sort.added")} / ${t(dir === "asc" ? "sort.asc" : "sort.desc")}`,
    );
  }
  return parts.join(" / ") || t("smartCollection.allMedia");
}
