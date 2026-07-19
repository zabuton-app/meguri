import { z } from "zod";
import { SearchQuerySchema, type SearchQuery } from "@shared/ipc/schema";
import { resolveSortDir } from "@shared/sortDir";
import type { TFunc } from "@/i18n/I18nProvider";

export const SMART_COLLECTIONS_KEY = "meguri.smartCollections.v1";

export const SmartCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: SearchQuerySchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SmartCollection = z.infer<typeof SmartCollectionSchema>;

const SmartCollectionsSchema = z.array(SmartCollectionSchema);

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
  if (query.playedVia) next.playedVia = query.playedVia;
  if (query.capturedFrom != null) next.capturedFrom = query.capturedFrom;
  if (query.capturedTo != null) next.capturedTo = query.capturedTo;
  if (query.btimeFrom != null) next.btimeFrom = query.btimeFrom;
  if (query.btimeTo != null) next.btimeTo = query.btimeTo;
  if (query.sort) next.sort = query.sort;
  if (query.sortDir) next.sortDir = query.sortDir;
  return next;
}

export function hasSearchConditions(query: SearchQuery): boolean {
  return Object.keys(cleanSearchQuery(query)).length > 0;
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

export function makeSmartCollection(
  name: string,
  query: SearchQuery,
): SmartCollection {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
    name: name.trim(),
    query: cleanSearchQuery(query),
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
  if (from != null && to != null)
    return `${formatDate(from)}–${formatDate(to)}`;
  if (from != null) return `${t("filter.dateFrom")} ${formatDate(from)}`;
  if (to != null) return `${t("filter.dateTo")} ${formatDate(to)}`;
  return "";
}

export function describeSearchQuery(t: TFunc, query: SearchQuery): string {
  const parts: string[] = [];
  if (query.q) parts.push(`"${query.q}"`);
  if (query.kind)
    parts.push(query.kind === "video" ? t("kind.video") : t("kind.image"));
  if (query.ratingMin) parts.push(`★${query.ratingMin}+`);
  if (query.favorite) parts.push(t("favorite.chip"));
  if (query.duplicates) parts.push(t("duplicates.chip"));
  if (query.played != null) {
    const label = query.played ? t("filter.played") : t("filter.unplayed");
    parts.push(query.playedVia ? `${label} (${query.playedVia})` : label);
  }
  if (query.capturedFrom != null || query.capturedTo != null) {
    parts.push(
      `${t("sort.captured")}: ${describeDateRange(t, query.capturedFrom, query.capturedTo)}`,
    );
  }
  if (query.btimeFrom != null || query.btimeTo != null) {
    parts.push(
      `${t("filter.btime")}: ${describeDateRange(t, query.btimeFrom, query.btimeTo)}`,
    );
  }
  for (const tag of query.tags ?? []) {
    const label = `${t("media.tags")}: ${tag}`;
    parts.push(query.tagSource ? `${label} (${query.tagSource})` : label);
  }
  if (query.sort || query.sortDir) {
    const sort = query.sort ?? "added";
    const key =
      sort === "name"
        ? "sort.name"
        : sort === "rating"
          ? "sort.rating"
          : sort === "captured"
            ? "sort.captured"
            : sort === "btime"
              ? "filter.btime"
              : sort === "accessed"
              ? "sort.accessed"
              : sort === "hash"
                ? "sort.hash"
                : "sort.added";
    const dir = resolveSortDir(sort, query.sortDir);
    parts.push(`${t(key)} / ${t(dir === "asc" ? "sort.asc" : "sort.desc")}`);
  }
  return parts.join(" / ") || t("smartCollection.allMedia");
}

export function defaultSmartCollectionName(
  t: TFunc,
  query: SearchQuery,
): string {
  if (query.favorite) return t("smartCollection.defaultFavorites");
  if (query.ratingMin)
    return t("smartCollection.defaultRating", { rating: query.ratingMin });
  if (query.played === false) return t("smartCollection.defaultUnplayed");
  if (query.q) return query.q;
  return t("smartCollection.defaultName");
}
