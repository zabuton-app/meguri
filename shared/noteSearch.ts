// Search-box directives that look at a file's note (file_meta.note) instead of
// its name: `note:<text>` and `has:note`. Shared by the query layer, which
// turns them into conditions, and the filter bar, which shows them.
//
// Neither goes through the full-text index. The note lives in the library
// every workspace shares, not in a workspace's files_fts, so they are
// conditions on file_meta (see appendSearchConditions).

export const NOTE_SEARCH_PREFIX = "note";

/** The one `has:` directive there is. Any other `has:` value is free text. */
export const HAS_NOTE_TOKEN = "has:note";

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

export function isHasNoteToken(token: string): boolean {
  return token.toLowerCase() === HAS_NOTE_TOKEN;
}

/** Whether a token is a note condition rather than text to find in names. */
export function isNoteDirective(token: string): boolean {
  return isHasNoteToken(token) || parseNoteSearchToken(token) !== null;
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
 * Whether a note satisfies every `note:` token of a query: for each group
 * (one token's alternatives, already passed through noteSearchKey), the note
 * contains at least one. SQL reaches it as `note_match(note, groupsJson)`
 * (see db.ts), so a note is folded once per row however many tokens and
 * alternatives the query has.
 */
export function noteMatches(note: string, groups: string[][]): boolean {
  const key = noteSearchKey(note);
  return groups.every((any) => any.some((term) => key.includes(term)));
}
