// Limits for the per-file note (file_meta.note, stored as Markdown).

/**
 * Characters of text the note editor accepts. Counted on the text people see,
 * not on the Markdown, so formatting never eats into it. The editor stops
 * input here, which is what keeps an over-long note from ever being unsaved.
 */
export const NOTE_MAX_CHARS = 10_000;

/**
 * Length of the stored Markdown the IPC boundary accepts: a guard against
 * absurd writes, not a limit people reach. It has to sit far above what the
 * app itself can produce, or a note would become impossible to save: the
 * editor counts text and a link's address is not text, so the Markdown for
 * NOTE_MAX_CHARS of text can be many times longer, and a merge joins two
 * notes without a limit.
 */
export const NOTE_MAX_MARKDOWN = 1_000_000;

/** A note with no text is stored as no note (NULL), rather than as an empty one. */
export function normalizeNote(note: string | null): string | null {
  if (note == null) return null;
  return note.trim() === "" ? null : note;
}
