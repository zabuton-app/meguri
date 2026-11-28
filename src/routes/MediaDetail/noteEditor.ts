// The note's editor, shared by the note card and the note template in
// Settings (#345): the Tiptap extensions, link handling and the state the
// toolbar shows, so the two edit the same Markdown the same way. The toolbar
// and save status themselves are in NoteToolbar.tsx.
import { useEditorState } from "@tiptap/react";
import type { Editor, Extensions } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import log from "@/lib/logger";
import { api } from "@/ipc/client";
import { NoteLink, NoteListItem, NoteParagraph } from "./noteExtensions";
import { NOTE_MAX_CHARS, normalizeNote } from "@shared/note";

/** Links in a note are http(s) only; that is all a note link opens to. */
export function isAllowedLink(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * An address typed without a scheme (`example.com`, `localhost:3000`) is
 * taken as https. Only `scheme://` counts as a scheme, so a host with a port
 * is not mistaken for one.
 */
export function withScheme(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

/** The extensions every note editor is built with. */
export function noteExtensions(placeholder: string): Extensions {
  return [
    StarterKit.configure({
      // Markdown has no underline.
      underline: false,
      // Replaced below by ones that keep what the user wrote.
      paragraph: false,
      link: false,
      listItem: false,
    }),
    NoteParagraph,
    NoteListItem,
    NoteLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: "https",
      isAllowedUri: (url, { defaultValidate }) =>
        defaultValidate(url) && isAllowedLink(url),
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown,
    // autoTrim off: a note longer than the limit (two joined by a merge)
    // must never be cut just by opening it, since that would then be saved.
    CharacterCount.configure({ limit: NOTE_MAX_CHARS, autoTrim: false }),
    Placeholder.configure({ placeholder }),
  ];
}

/**
 * A click on a link in a note (editorProps.handleDOMEvents.click): never lets
 * the window navigate; opens the link through open_url when the note is only
 * shown, or with Ctrl/Cmd while it is edited.
 */
export function noteLinkClick(view: EditorView, event: MouseEvent): boolean {
  const a = (event.target as HTMLElement | null)?.closest?.("a[href]");
  if (!a) return false;
  // Never let the window itself navigate.
  event.preventDefault();
  if (!view.editable || event.ctrlKey || event.metaKey) {
    const href = a.getAttribute("href") ?? "";
    api
      .openUrl(href)
      .catch((e: unknown) => log.warn("could not open link:", e));
    return true;
  }
  return false;
}

export interface ActiveMarks {
  heading: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  link: boolean;
}

export interface NoteMarks extends ActiveMarks {
  isEmpty: boolean;
  /** Characters of text, as the editor's limit counts them. */
  chars: number;
}

/**
 * Where to put the caret in a note just started from the template (#345):
 * inside its first empty line, so writing starts under the first heading.
 * Null when every line has text.
 */
export function firstEmptyTextblockPos(doc: ProseMirrorNode): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isTextblock && node.content.size === 0) found = pos + 1;
    return found === null;
  });
  return found;
}

/**
 * The note an editor holds, as stored: null for no note, and null too while it
 * is still exactly the template it was started from (`started`).
 */
export function noteOf(editor: Editor, started: string | null): string | null {
  const note = normalizeNote(editor.isEmpty ? null : editor.getMarkdown());
  return note !== null && note === started ? null : note;
}

/** What the toolbar and the character count show, kept up to date. */
export function useNoteMarks(editor: Editor): NoteMarks {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      isEmpty: e.isEmpty,
      // While the editor is created again for a note changed elsewhere, this
      // still sees the old one once, already destroyed (its storage gone).
      chars: e.isDestroyed ? 0 : e.storage.characterCount.characters(),
      heading: e.isActive("heading"),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      blockquote: e.isActive("blockquote"),
      link: e.isActive("link"),
    }),
  });
}
