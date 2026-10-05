import { z } from "zod";
import { SearchQuerySchema, type SearchQuery } from "@shared/ipc/schema";
import { ROOT_FOLDER } from "@shared/folderPath";
import { MANUAL_SORT, resolveSortDir } from "@shared/sortDir";
import { parseQualifiedTagName } from "@shared/tags";
import type { TFunc } from "@/i18n/I18nProvider";
import { kindLabelKey } from "@/lib/mediaKind";
import { SORT_KEYS } from "@/lib/sortLabel";
import { tagHumanLabel } from "@/lib/tagLabel";

export const SMART_COLLECTIONS_KEY = "meguri.smartCollections.v1";

export const SmartCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: SearchQuerySchema,
  /**
   * The workspace `query.folder` lies in. A folder path means nothing outside
   * its own workspace, so it is saved only together with one.
   */
  workspaceId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SmartCollection = z.infer<typeof SmartCollectionSchema>;

const SmartCollectionsSchema = z.array(SmartCollectionSchema);

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
  if (query.ratingMin != null && query.ratingMin > 0)
    next.ratingMin = query.ratingMin;
  if (query.favorite) next.favorite = true;
  if (query.duplicates) next.duplicates = true;
  if (query.played != null) next.played = query.played;
  if (query.inProgress) next.inProgress = true;
  if (query.playedVia) next.playedVia = query.playedVia;
  if (query.capturedFrom != null) next.capturedFrom = query.capturedFrom;
  if (query.capturedTo != null) next.capturedTo = query.capturedTo;
  if (query.btimeFrom != null) next.btimeFrom = query.btimeFrom;
  if (query.btimeTo != null) next.btimeTo = query.btimeTo;
  if (query.addedFrom != null) next.addedFrom = query.addedFrom;
  if (query.addedTo != null) next.addedTo = query.addedTo;
  if (query.playedFrom != null) next.playedFrom = query.playedFrom;
  if (query.playedTo != null) next.playedTo = query.playedTo;
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

export function parseSmartCollections(raw: string | null): SmartCollection[] {
  if (!raw) return [];
  try {
    const parsed = SmartCollectionsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return parsed.data;
  } catch {
    return [];
  }
}

export function saveSmartCollections(collections: SmartCollection[]): void {
  try {
    localStorage.setItem(SMART_COLLECTIONS_KEY, JSON.stringify(collections));
  } catch {
    // Storage can be unavailable; keep the in-memory UI responsive.
  }
}

/**
 * The saved search the list opens with (and "Clear all" returns to). Kept
 * apart from the collections so their stored shape does not change.
 */
export const DEFAULT_SMART_COLLECTION_KEY = "meguri.smartCollections.default";

export function loadDefaultSmartCollectionId(): string | null {
  try {
    return localStorage.getItem(DEFAULT_SMART_COLLECTION_KEY) || null;
  } catch {
    return null;
  }
}

export function saveDefaultSmartCollectionId(id: string | null): void {
  try {
    if (id) localStorage.setItem(DEFAULT_SMART_COLLECTION_KEY, id);
    else localStorage.removeItem(DEFAULT_SMART_COLLECTION_KEY);
  } catch {
    // Storage can be unavailable; keep the in-memory UI responsive.
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

/** The filter the list starts with: the default saved search, or nothing. */
export function loadInitialFilter(): SearchQuery {
  try {
    return (
      defaultQueryOf(
        parseSmartCollections(localStorage.getItem(SMART_COLLECTIONS_KEY)),
        loadDefaultSmartCollectionId(),
      ) ?? {}
    );
  } catch {
    return {};
  }
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
function formatDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString();
}

/**
 * Human label for a possibly open-ended date range (Unix seconds). Open ends
 * are spelled out ("From …" / "To …") rather than left as a dangling dash.
 * Exported for the active-filter chips, which show the same ranges.
 */
export function describeDateRange(
  t: TFunc,
  from: number | undefined,
  to: number | undefined,
): string {
  if (from != null && to != null) {
    // One day (a day picked on the heatmap, say) reads as that day.
    const [first, last] = [formatDate(from), formatDate(to)];
    return first === last ? first : `${first}–${last}`;
  }
  if (from != null) return `${t("filter.dateFrom")} ${formatDate(from)}`;
  if (to != null) return `${t("filter.dateTo")} ${formatDate(to)}`;
  return "";
}

export function describeSearchQuery(t: TFunc, query: SearchQuery): string {
  const parts: string[] = [];
  const folder = scopedFolderPath(query);
  if (folder != null) parts.push(`${t("folder.chip")}: ${folder}`);
  if (query.q) parts.push(`"${query.q}"`);
  if (query.kind) {
    const key = kindLabelKey(query.kind);
    parts.push(key ? t(key) : query.kind);
  }
  if (query.ratingMin) parts.push(`★${query.ratingMin}+`);
  if (query.favorite) parts.push(t("favorite.chip"));
  if (query.duplicates) parts.push(t("duplicates.chip"));
  if (query.played != null) {
    const label = query.played ? t("filter.played") : t("filter.unplayed");
    parts.push(query.playedVia ? `${label} (${query.playedVia})` : label);
  }
  if (query.inProgress) parts.push(t("filter.inProgress"));
  if (query.capturedFrom != null || query.capturedTo != null) {
    parts.push(
      `${t("filter.capturedAt")}: ${describeDateRange(t, query.capturedFrom, query.capturedTo)}`,
    );
  }
  if (query.btimeFrom != null || query.btimeTo != null) {
    parts.push(
      `${t("filter.btime")}: ${describeDateRange(t, query.btimeFrom, query.btimeTo)}`,
    );
  }
  if (query.addedFrom != null || query.addedTo != null) {
    parts.push(
      `${t("filter.addedAt")}: ${describeDateRange(t, query.addedFrom, query.addedTo)}`,
    );
  }
  if (query.playedFrom != null || query.playedTo != null) {
    parts.push(
      `${t("filter.playedAt")}: ${describeDateRange(t, query.playedFrom, query.playedTo)}`,
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
