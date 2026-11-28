// The file's note: Markdown, shown and edited in place with Tiptap, and saved
// as the user types. Loaded lazily by the detail view so the editor's code is
// only fetched once a detail is open.
//
// Mount one per file (keyed by workspace and file id): the pending write is
// flushed when it unmounts, so moving to another file or closing the detail
// still saves what was typed last.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { useNoteTemplate } from "@/hooks/useNoteTemplate";
import {
  invalidateNoteSearches,
  patchFileDetailInCache,
} from "@/lib/queryCache";
import { useNoteWriter } from "./useNoteWriter";
import {
  firstEmptyTextblockPos,
  noteExtensions,
  noteLinkClick,
  noteOf,
  useNoteMarks,
} from "./noteEditor";
import { NoteSaveStatus, NoteToolbar } from "./NoteToolbar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NOTE_MAX_CHARS, normalizeNote } from "@shared/note";

/** Height (px) above which a note is shown collapsed until "Show all". */
const COLLAPSED_PX = 240;

export default function NoteCard({
  fileId,
  wsId,
  note,
}: {
  fileId: number;
  wsId: string;
  /** The note as the detail last loaded it. */
  note: string | null;
}) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const save = useCallback(
    async (value: string | null) => {
      await api.fileSetNote(fileId, wsId, value);
      patchFileDetailInCache(qc, wsId, fileId, { note: value });
      // Only the views filtered by a note can change membership.
      invalidateNoteSearches(qc);
    },
    [fileId, wsId, qc],
  );
  const { state, schedule, flush, adopt } = useNoteWriter(save, note);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { template } = useNoteTemplate();
  // A note just started from the template (#345): the template as the editor
  // wrote it back, which counts as no note until something is typed, and
  // where the caret goes. Null otherwise.
  const started = useRef<string | null>(null);
  const caret = useRef<number | null>(null);

  // Stable for the card's lifetime, as the writer's callbacks are: the editor
  // is configured once and keeps calling the ones it was given.
  const finishEditing = useCallback(() => {
    flush();
    setEditing(false);
  }, [flush]);

  // The note the editor was created with. A note changed elsewhere is shown
  // by creating the editor again with it rather than by setContent, which
  // CharacterCount refuses for a note over the limit (a merged one can be).
  const [shown, setShown] = useState(note);

  const editor = useEditor(
    {
      editable: false,
      content: shown ?? "",
      contentType: "markdown",
      extensions: noteExtensions(t("media.note.placeholder")),
      editorProps: {
        attributes: {
          class: "note-content outline-none",
          "aria-label": t("media.note"),
        },
        handleKeyDown: (_view, event) => {
          if (event.key !== "Escape") return false;
          // Claimed, so the detail view does not close on the same key.
          event.preventDefault();
          finishEditing();
          return true;
        },
        handleDOMEvents: { click: noteLinkClick },
      },
      onUpdate: ({ editor: e }) => schedule(noteOf(e, started.current)),
      onBlur: flush,
    },
    [shown],
  );

  const view = useNoteMarks(editor);

  const startEditing = () => {
    // The template as it is now, read when the note is started.
    if (view.isEmpty && template) {
      editor.commands.setContent(template, {
        contentType: "markdown",
        emitUpdate: false,
      });
      started.current = normalizeNote(editor.getMarkdown());
      caret.current = firstEmptyTextblockPos(editor.state.doc);
    }
    setEditing(true);
    setExpanded(true);
  };
  useEffect(() => {
    editor.setEditable(editing, false);
    if (editing) {
      editor.commands.focus(caret.current ?? "end");
      caret.current = null;
    } else if (started.current !== null) {
      // Left as the template: it was no note, so show none.
      if (noteOf(editor, started.current) === null) {
        editor.commands.setContent("", { emitUpdate: false });
      }
      started.current = null;
    }
  }, [editor, editing]);

  // The note changed elsewhere (another window, a merge) while nothing is
  // being typed here: show it. Our own saves land as the same text.
  useEffect(() => {
    const incoming = normalizeNote(note);
    if (editing || !adopt(incoming)) return;
    // Has to follow adopt(), which reads and sets the writer's refs; it runs
    // only when the note really changed elsewhere, so this does not cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShown(incoming);
  }, [note, editing, adopt]);

  // Whether the shown note is taller than the collapsed height.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollHeight > COLLAPSED_PX + 24);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const collapsed = !editing && !expanded && overflowing;
  const showAdd = !editing && view.isEmpty;

  return (
    // Separated from the sections around it by a rule, like them (#589). While
    // editing, only the area being typed in gets a field's frame.
    <section
      aria-label={t("media.note")}
      className="flex flex-col gap-3 border-t border-border py-4"
    >
      <div className="flex min-h-7 items-center gap-2">
        <span className="text-xs font-semibold uppercase text-muted">
          {t("media.note")}
        </span>
        <NoteSaveStatus state={state} onRetry={flush} t={t} />
        {!editing && !view.isEmpty && (
          <Button
            variant="outline"
            size="compact"
            className="ml-auto"
            onClick={startEditing}
          >
            <Pencil />
            {t("media.note.edit")}
          </Button>
        )}
      </div>

      {showAdd && (
        <button
          type="button"
          onClick={startEditing}
          className="flex h-14 items-center justify-center gap-2 rounded-card border border-dashed border-border-strong text-sm text-muted hover:bg-fg/10 hover:text-bright-fg"
        >
          <Plus className="size-4" />
          {t("media.note.add")}
        </button>
      )}

      {editing && <NoteToolbar editor={editor} active={view} t={t} />}

      <div
        ref={contentRef}
        hidden={showAdd}
        className={cn(
          "relative",
          editing &&
            "min-h-40 rounded-control border border-border-strong bg-bg px-3 py-3 focus-within:border-ring",
          collapsed && "overflow-hidden",
        )}
        style={
          collapsed
            ? {
                maxHeight: COLLAPSED_PX,
                maskImage: "linear-gradient(#000 70%, transparent)",
              }
            : undefined
        }
      >
        <EditorContent editor={editor} />
      </div>

      {!editing && overflowing && !view.isEmpty && (
        <Button
          variant="outline"
          size="compact"
          className="self-start"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t("media.note.showLess") : t("media.note.showAll")}
        </Button>
      )}

      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-xs",
              view.chars >= NOTE_MAX_CHARS ? "text-warn" : "text-muted",
            )}
          >
            {t("media.note.count", {
              count: view.chars.toLocaleString(lang),
              max: NOTE_MAX_CHARS.toLocaleString(lang),
            })}
            {" · "}
            {view.chars >= NOTE_MAX_CHARS
              ? t("media.note.limit")
              : t("media.note.hint")}
          </span>
          <Button
            variant="outline"
            size="compact"
            className="ml-auto"
            onClick={finishEditing}
          >
            {t("media.note.done")}
          </Button>
        </div>
      )}
    </section>
  );
}
