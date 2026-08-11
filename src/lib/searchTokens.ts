import {
  TAG_SEARCH_PREFIX,
  hasOpenQuote,
  isTagDirective,
  joinSearchTokens,
  splitSearchTokens,
} from "@shared/tags";
import type { TagSummary } from "@/ipc/types";

/**
 * Split a query into the exact-tag directives the search box shows as chips and
 * the free text it leaves editable.
 *
 * Only the initial read of an incoming query goes through here — while the user
 * types, the box tracks the two parts itself, because a half-typed `tag:bea`
 * parses as a directive but must stay text until it is closed.
 */
export function splitQueryChips(q: string): { chips: string[]; text: string } {
  const tokens = splitSearchTokens(q);
  return {
    chips: tokens.filter(isTagDirective),
    text: joinSearchTokens(tokens.filter((token) => !isTagDirective(token))),
  };
}

export interface PendingDirective {
  /** What has been typed after `tag:`; empty right after the colon. */
  value: string;
}

/**
 * The directive the caret is sitting in, or null when the last thing typed is
 * ordinary text. Completion has nothing to offer in the latter case: the free
 * text goes to the full-text index, which needs no help from a tag list.
 *
 * A token followed by a space is closed — it has already become a chip — so only
 * the tail of an unfinished query ever qualifies.
 */
export function pendingDirective(draft: string): PendingDirective | null {
  if (/\s$/.test(draft) && !hasOpenQuote(draft)) return null;
  const tokens = splitSearchTokens(draft);
  const tail = tokens[tokens.length - 1];
  if (tail === undefined) return null;
  const head = `${TAG_SEARCH_PREFIX}:`;
  if (!tail.toLowerCase().startsWith(head)) return null;
  return { value: tail.slice(head.length) };
}

/** How many completions the search box offers at once. */
export const MAX_TAG_SUGGESTIONS = 10;

/**
 * Catalog entries that could complete the directive under the caret — the user's
 * own tags and the generated ones together, since one directive matches both.
 *
 * The match is a case-insensitive **substring**, not a prefix — a tag is as often
 * remembered by a word in the middle of it as by its first letters — with prefix
 * hits ranked first so the obvious completion still comes out on top, then by how
 * many files carry the tag.
 */
export function tagSuggestions(
  tags: TagSummary[],
  pending: PendingDirective,
  limit: number = MAX_TAG_SUGGESTIONS,
): TagSummary[] {
  const q = pending.value.trim().toLowerCase();
  const hits = tags.filter(
    (tag) =>
      tag.name.toLowerCase().includes(q) ||
      tag.qualified.toLowerCase().includes(q),
  );
  const rank = (tag: TagSummary) =>
    tag.name.toLowerCase().startsWith(q) ? 0 : 1;
  return hits
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.fileCount - a.fileCount ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}
