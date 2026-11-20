import {
  AUTO_META_NAMESPACES,
  CLOSED_TAG_VALUES,
  TAG_SEARCH_PREFIX,
  hasOpenQuote,
  isSearchDirective,
  joinSearchTokens,
  tagIdentityKey,
  splitSearchTokens,
} from "@shared/tags";
import { ALL_ID, COLLECTION_ID_PREFIX } from "@shared/workspaceIds";
import type { TagSummary } from "@/ipc/types";

/**
 * Split a query into the directives (`tag:`, `hash:`) the search shows as
 * chips and the free text it leaves editable.
 *
 * Only the initial read of an incoming query goes through here — while the user
 * types, the command menu's draft (useSearchDraft) tracks the two parts itself,
 * because a half-typed `tag:bea` parses as a directive but must stay text until
 * it is closed.
 */
export function splitQueryChips(q: string): { chips: string[]; text: string } {
  const tokens = splitSearchTokens(q);
  return {
    chips: tokens.filter(isSearchDirective),
    text: joinSearchTokens(tokens.filter((token) => !isSearchDirective(token))),
  };
}

/** The query of `chips` and `text`: what splitQueryChips takes apart. */
export function joinQueryChips(chips: string[], text: string): string {
  return [joinSearchTokens(chips), text.trim()]
    .filter((part) => part !== "")
    .join(" ");
}

export interface PendingDirective {
  /** What has been typed after `tag:`; empty right after the colon. */
  value: string;
  /**
   * Match tag names only, not namespaces: set for an ordinary word (#542),
   * whose user does not see the namespaces the list would otherwise hit.
   */
  namesOnly?: boolean;
}

/**
 * The directive the caret is sitting in, or null when the last thing typed is
 * ordinary text, which plainWordAtCaret completes instead (#542).
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

/**
 * The catalog with every value of a closed set it lacks added, as a tag no
 * file carries yet, once the namespace has been typed (`audio_quality:`, or
 * `audio_quality:hi`), so completion can offer it (`audio_quality:hires` in a
 * library with no hi-res file). Added after the catalog's own entries; a
 * bare value or a namespace not typed yet adds nothing.
 */
export function withClosedValues(
  tags: readonly TagSummary[],
  typed: string,
): TagSummary[] {
  const lower = typed.trim().toLowerCase();
  const at = lower.indexOf(":");
  const values = at > 0 ? CLOSED_TAG_VALUES[lower.slice(0, at)] : undefined;
  if (!values) return [...tags];
  const namespace = lower.slice(0, at);
  const have = new Set(tags.map((tag) => tag.qualified));
  const missing: TagSummary[] = values
    .filter((name) => !have.has(`${namespace}:${name}`))
    .map((name) => ({
      namespace,
      name,
      qualified: `${namespace}:${name}`,
      fileCount: 0,
      bySource: [],
      pipelineOwned: true,
      workspaceIds: [],
    }));
  return [...tags, ...missing];
}

/** Scripts in which one character can be a word (`猫`, `夢`). */
const WORD_PER_CHARACTER =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

/**
 * The ordinary word at the end of the text, or null: when the text ends with
 * a space, is in a directive, offers alternatives (`jazz|rock`, which a pick
 * would replace whole), or is too short to be worth a list. Two characters,
 * or one in a script where one is a word; counted by code point.
 */
export function plainWordAtCaret(draft: string): string | null {
  if (/\s$/.test(draft) || hasOpenQuote(draft)) return null;
  // One form of each letter, so `é` is one character however it was typed.
  const tail = splitSearchTokens(draft).at(-1)?.normalize("NFC");
  if (tail === undefined || tail.includes(":") || tail.includes("|"))
    return null;
  const length = [...tail].length;
  return length >= 2 || (length === 1 && WORD_PER_CHARACTER.test(tail))
    ? tail
    : null;
}

/**
 * A tag's name as tagIdentityKey folds it, worked out once per catalog entry:
 * a word is matched against the whole catalog on every keystroke.
 */
const nameKeys = new WeakMap<TagSummary, string>();
function nameKey(tag: TagSummary): string {
  let key = nameKeys.get(tag);
  if (key === undefined) {
    key = tagIdentityKey(tag.name);
    nameKeys.set(tag, key);
  }
  return key;
}

/**
 * The generated namespaces a word begins (`tempo` → `audio_tempo`), by their
 * name without `audio_`, their full name once a `_` is typed, or their label
 * in the app's language (`label`), compared as tag names are. A beginning,
 * not any part: `au` is not every `audio_` namespace.
 */
export function namespaceSuggestions(
  word: string,
  label: (namespace: string) => string,
): string[] {
  const key = tagIdentityKey(word);
  return AUTO_META_NAMESPACES.filter(
    (ns) =>
      ns.replace(/^audio_/, "").startsWith(key) ||
      (key.includes("_") && ns.startsWith(key)) ||
      tagIdentityKey(label(ns)).startsWith(key),
  );
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
 *
 * With `held`, the tags it says are on view come before the ones held only
 * elsewhere: a catalog of the whole library is offered against one workspace,
 * and a tag the workspace does not carry would find nothing in it.
 */
export function tagSuggestions(
  tags: TagSummary[],
  pending: PendingDirective,
  limit: number = MAX_TAG_SUGGESTIONS,
  held: (tag: TagSummary) => boolean = () => true,
): TagSummary[] {
  const q = pending.value.trim().toLowerCase();
  // A word is compared as tag names are (tagIdentityKey), for the match and
  // the ranking alike: case, spacing and invisible characters do not make
  // another tag.
  const key = pending.namesOnly ? tagIdentityKey(pending.value) : "";
  const hits = tags.filter((tag) =>
    pending.namesOnly
      ? nameKey(tag).includes(key)
      : tag.name.toLowerCase().includes(q) ||
        tag.qualified.toLowerCase().includes(q),
  );
  const startsWith = (tag: TagSummary) =>
    pending.namesOnly
      ? nameKey(tag).startsWith(key)
      : tag.name.toLowerCase().startsWith(q);
  const rank = (tag: TagSummary) =>
    (held(tag) ? 0 : 2) + (startsWith(tag) ? 0 : 1);
  return hits
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.fileCount - a.fileCount ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

/**
 * Whether the view is of one workspace, as opposed to all of them or a
 * collection (which spans them): only then is a tag held elsewhere out of
 * reach of a search.
 */
export function viewIsOneWorkspace(workspaceId: string | null): boolean {
  return (
    workspaceId !== null &&
    workspaceId !== ALL_ID &&
    !workspaceId.startsWith(COLLECTION_ID_PREFIX)
  );
}
