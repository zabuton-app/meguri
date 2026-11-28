# Note Markdown

A file's note (`file_meta.note`, #343) and the note template (#345) are stored
as Markdown. This page records which Markdown the note editor reads and
writes, so a change to the editor or to its Markdown library can be checked
against it. It reflects `@tiptap/markdown` 3.35.1 with `marked` 17.0.6, checked
on 2026-11-28 by reading each form below into the note editor and writing it
back.

## How a note is read and written

- The note is edited in place with Tiptap (`src/routes/MediaDetail/NoteCard.tsx`,
  and `src/routes/Settings/NoteTemplateSection.tsx` for the template). Both
  build the editor from `noteExtensions()` in
  `src/routes/MediaDetail/noteEditor.ts`, so they read and write the same
  Markdown.
- Reading goes through `@tiptap/markdown`, which parses with `marked`. GitHub
  Flavored Markdown is on (marked's default), so the looser forms GitHub
  accepts are read too.
- Only what the editor has an extension for is kept: StarterKit (headings,
  bold, italic, strikethrough, inline code, code blocks, lists, blockquotes,
  horizontal rules, hard breaks), task lists and links. Anything else is
  dropped or changed when read (see below).
- Writing always uses one form per construct, so a note read in a looser form
  is written back in the editor's form the next time it is saved.

## Read as written

| Markdown                                              | Read as                | Written back as            |
| ----------------------------------------------------- | ---------------------- | -------------------------- |
| `*`, `+` or `-` bullets                               | a bulleted list        | `-`                        |
| `1.` or `1)`, or every item numbered `1.`             | a numbered list        | `1.`, `2.`, `3.`           |
| A list right after a paragraph, with no blank line    | a paragraph and a list | a blank line between them  |
| Nested items indented by 2 or 4 spaces                | a nested list          | 2 spaces                   |
| `- [ ]` and `- [x]`                                   | a task list            | `- [ ]` and `- [x]`        |
| `# Title`, `## Title ##` (closing hashes)             | a heading              | `#` without closing hashes |
| `Title` underlined with `===` or `---` (setext)       | a heading              | `#` (ATX)                  |
| `**bold**`, `__bold__`                                | bold                   | `**bold**`                 |
| `*italic*`, `_italic_`                                | italic                 | `*italic*`                 |
| `~~strike~~`, `~strike~`                              | strikethrough          | `~~strike~~`               |
| `` `code` ``                                          | inline code            | `` `code` ``               |
| Fenced with backticks or tildes, or indented 4 spaces | a code block           | fenced with backticks      |
| `> quote`                                             | a blockquote           | `> quote`                  |
| `---`, `***`                                          | a horizontal rule      | `---`                      |
| `[text](https://…)`                                   | a link                 | `[text](https://…)`        |
| `<https://…>` or a bare URL in text                   | a link                 | `[https://…](https://…)`   |
| Two spaces at the end of a line                       | a hard break           | two spaces and a newline   |
| A single newline inside a paragraph                   | kept as a newline      | a newline                  |
| `\*` and other backslash escapes                      | the character itself   | escaped again where needed |

## Not read as written

| Markdown                                 | What happens                                                     |
| ---------------------------------------- | ---------------------------------------------------------------- |
| A pipe table                             | The table and its text are dropped: there is no table extension. |
| An image, `![alt](url)`                  | Only the alt text is kept; the address is lost.                  |
| A footnote, `text[^1]` with `[^1]: note` | Read as a link and mangled.                                      |
| `#Title` (no space after `#`)            | Stays text, as on GitHub.                                        |
| Inline HTML such as `<b>` or `<br>`      | Read as the formatting it names, then written as Markdown.       |

These only matter for Markdown that comes from outside the editor. Nothing
does today: notes are only ever written by the editor, which escapes what it
writes (see the next section). Pasting Markdown text into the editor has not
been checked.

## Text typed in the editor survives a save

What someone types is stored so that it reads back as typed:

- Text that looks like Markdown is escaped when written: `![alt](…)` becomes
  `!\[alt\](…)`, `[^1]` becomes `\[^1\]`, `<b>` becomes `&lt;b&gt;`.
- Lines typed one per paragraph that look like a table are written as separate
  paragraphs, so they are not read back as a table.
- `NoteParagraph` (`src/routes/MediaDetail/noteExtensions.ts`) escapes a
  paragraph line that would start a block when read back: `1.`, `-`, `+` or
  `#` followed by a space, and a line of only `-` or `=`.
- `NoteListItem` writes an empty bullet as `-` alone. The list item Tiptap
  ships writes it as `-` followed by a space, which `@tiptap/markdown` reads
  back as that text when it starts a list (#345).

## Known differences after a round trip

- A nested empty list item is written with a no-break space (`&nbsp;`, Tiptap's
  own placeholder), so it reads back as an item holding that space. It looks
  empty.
- An empty numbered item reads back as an item with no paragraph inside. It
  looks the same.
- A note that ends with a heading gets an empty paragraph after it, which
  Tiptap adds after a closing heading or list. The note is then saved with a
  trailing blank line.

## Changing what notes support

To support a construct from the second table (a table, an image), add its
Tiptap extension to `noteExtensions()` so both the note and the template get
it, and give it a round-trip test like
`src/routes/MediaDetail/__tests__/noteEmptyBullet.test.ts`: set the content,
write it to Markdown, read it back and compare the documents. Check that text
typed in the editor still reads back as typed (the previous section), since a
new extension can make plain text start being read as that construct.
