// What the renderer knows about media kinds: the list, how each is labelled and
// iconed, and how a selection of them is normalized for a query.
//
// `FileRow.kind` is typed as a plain string end to end (see shared/ipc/schema.ts), so
// TypeScript cannot flag the `kind === "video" ? … : …` shape that silently treats
// "not video" as "image". Consolidating those sites here means adding a kind touches
// one file instead of nine, and an unknown kind (a saved search from a newer
// build, say) degrades to a neutral fallback rather than being mislabelled.
import { File, Film, ImageIcon, Music, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/i18n/locales/ja";
import { KindSchema } from "@shared/ipc/schema";

/** Every kind the app indexes, in the order the filter bar lists them. */
export const MEDIA_KINDS: readonly string[] = KindSchema.options;

/**
 * The kinds a query filters by, in a fixed order with repeats dropped, so two
 * selections of the same kinds make the same query. Undefined when that is no
 * filter at all: nothing selected, or every kind. A kind this build does not
 * know (a saved search from a newer one) is kept, after the known ones.
 */
export function normalizeKinds(
  kinds: readonly string[] | undefined,
): string[] | undefined {
  if (!kinds?.length) return undefined;
  const known = MEDIA_KINDS.filter((k) => kinds.includes(k));
  const unknown = [
    ...new Set(kinds.filter((k) => k && !MEDIA_KINDS.includes(k))),
  ];
  if (unknown.length === 0 && known.length === MEDIA_KINDS.length)
    return undefined;
  const out = [...known, ...unknown];
  return out.length ? out : undefined;
}

/** Translation key for a known kind; null for one this build has no name for. */
export function kindLabelKey(kind: string): TranslationKey | null {
  switch (kind) {
    case "video":
      return "kind.video";
    case "image":
      return "kind.image";
    case "audio":
      return "kind.audio";
    default:
      return null;
  }
}

export function kindIcon(kind: string): LucideIcon {
  switch (kind) {
    case "video":
      return Film;
    case "image":
      return ImageIcon;
    case "audio":
      return Music;
    default:
      return File;
  }
}

/** True for kinds that play along a timeline (and so carry a duration). */
export function hasTimeline(kind: string): boolean {
  return kind === "video" || kind === "audio";
}

/** Translated label for a kind, or the raw value when this build has no name for it. */
export function kindLabel(
  t: (key: TranslationKey) => string,
  kind: string,
): string {
  const key = kindLabelKey(kind);
  return key ? t(key) : kind;
}
