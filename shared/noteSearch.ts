// Search-box directives that look at a file's note (file_meta.note) instead of
// its name: `note:<text>` and `has:note`. Shared by the query layer, which
// turns them into conditions, and the filter bar, which shows them.
//
// Neither goes through the full-text index. The note lives in the library
// every workspace shares, not in a workspace's files_fts, so they are
// conditions on file_meta (see directiveCondition). The directives themselves
// are read with the others, by parseSearchDirective in shared/tags.ts.

export const NOTE_SEARCH_PREFIX = "note";

/** `has:note`: the one value `has:` takes. Any other `has:` value is free text. */
export const HAS_SEARCH_PREFIX = "has";
export const HAS_NOTE_VALUE = "note";

/**
 * The text of a `note:` token, or null when the token is something else.
 * `note:` with nothing after it is ordinary text, as `tag:` is.
 */
export function parseNoteSearchToken(token: string): string | null {
  const head = `${NOTE_SEARCH_PREFIX}:`;
  if (!token.toLowerCase().startsWith(head)) return null;
  const value = token.slice(head.length).trim();
  return value || null;
}

/** True for a `has:note` token, in any case, as `is:fav` is read. */
export function isHasNoteToken(token: string): boolean {
  const head = `${HAS_SEARCH_PREFIX}:`;
  if (!token.toLowerCase().startsWith(head)) return false;
  return token.slice(head.length).trim().toLowerCase() === HAS_NOTE_VALUE;
}

/**
 * The form a note and a `note:` value are compared in: composed the same way
 * (NFKC, so full-width and half-width letters meet) and lowercased for every
 * script, which SQLite's own lower() does for ASCII only.
 */
export function noteSearchKey(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/**
 * Whether a note contains any of one `note:` token's alternatives, already
 * passed through noteSearchKey. SQL reaches it as `note_match(note, termsJson)`
 * (see db.ts), once per row and token.
 */
export function noteMatches(note: string, terms: string[]): boolean {
  const key = noteSearchKey(note);
  return terms.some((term) => key.includes(term));
}
