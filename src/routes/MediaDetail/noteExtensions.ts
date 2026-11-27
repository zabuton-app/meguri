// Tiptap extensions the note editor (NoteCard) uses in place of StarterKit's
// own, where those would change what the user wrote.
import { Link } from "@tiptap/extension-link";
import { Paragraph } from "@tiptap/extension-paragraph";

/**
 * Escape what would start a block if a paragraph's line were read back as
 * Markdown. @tiptap/markdown escapes `*`, `_` and `>` in text, but not a line
 * that begins with `1. `, `- `, `+ `, `# ` or is `---`, so typed text such as
 * "1. You may reuse…" would come back as a list, a heading or a rule.
 */
export function escapeLineStarts(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) =>
      line
        // ATX heading: `#` to `######` then a space or the end.
        .replace(/^(\s*)(#{1,6})(?=\s|$)/, "$1\\$2")
        // Bullet: `-` or `+` then a space or the end (`*` is escaped already).
        .replace(/^(\s*)([-+])(?=\s|$)/, "$1\\$2")
        // Ordered list: digits then `.` or `)`, then a space or the end.
        .replace(/^(\s*)(\d{1,9})([.)])(?=\s|$)/, "$1$2\\$3")
        // A line of only `-` or `=`: a thematic break or a setext underline.
        .replace(/^(\s*)([-=])(?=\2*\s*$)/, "$1\\$2"),
    )
    .join("\n");
}

/** A paragraph whose Markdown reads back as the same paragraph. */
export const NoteParagraph = Paragraph.extend({
  renderMarkdown(node, h, ctx) {
    const out = this.parent?.(node, h, ctx) ?? "";
    return escapeLineStarts(out);
  },
});

/**
 * A link that text typed right after it does not join. Link makes itself
 * inclusive whenever autolink is on, which would turn a note like
 * "https://… (CC0)" into one long link.
 */
export const NoteLink = Link.extend({
  inclusive() {
    return false;
  },
});
