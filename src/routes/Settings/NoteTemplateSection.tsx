// Settings › Library: the template a new note starts from (#345), edited with
// the note's own editor and saved as the user types, as a note is.
import { useCallback } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { useNoteTemplate } from "@/hooks/useNoteTemplate";
import { useNoteWriter } from "@/routes/MediaDetail/useNoteWriter";
import {
  noteExtensions,
  noteLinkClick,
  noteOf,
  useNoteMarks,
} from "@/routes/MediaDetail/noteEditor";
import { NoteSaveStatus, NoteToolbar } from "@/routes/MediaDetail/NoteToolbar";
import { NOTE_MAX_CHARS } from "@shared/note";

export function NoteTemplateSection() {
  const { t } = useI18n();
  const { template, loaded } = useNoteTemplate();
  return (
    <section className="flex flex-col gap-3 border-b border-border py-3">
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-bright-fg">
          {t("settings.noteTemplate")}
        </span>
        <span className="text-xs text-muted">
          {t("settings.noteTemplateDesc")}
        </span>
      </div>
      {/* Created once the stored template is in, so it starts from it. */}
      {loaded && <TemplateEditor initial={template} />}
    </section>
  );
}

function TemplateEditor({ initial }: { initial: string }) {
  const { t, lang } = useI18n();
  const { setTemplate } = useNoteTemplate();
  const save = useCallback(
    async (value: string | null) => {
      setTemplate(await api.noteTemplateSet(value ?? ""));
    },
    [setTemplate],
  );
  const { state, schedule, flush } = useNoteWriter(save, initial || null);

  const editor = useEditor({
    content: initial,
    contentType: "markdown",
    extensions: noteExtensions(t("media.note.placeholder")),
    editorProps: {
      attributes: {
        class: "note-content outline-none",
        "aria-label": t("settings.noteTemplate"),
      },
      // ProseMirror claims every Esc, which Settings reads as handled by a
      // layer on top and so stays open. Esc leaves the editor instead, as it
      // finishes a note; the next one closes Settings.
      handleKeyDown: (view, event) => {
        if (event.key !== "Escape") return false;
        view.dom.blur();
        return true;
      },
      handleDOMEvents: { click: noteLinkClick },
    },
    onUpdate: ({ editor: e }) => schedule(noteOf(e, null)),
    onBlur: flush,
  });
  const marks = useNoteMarks(editor);

  return (
    <>
      <NoteToolbar editor={editor} active={marks} t={t} />
      <div className="min-h-40 rounded-control border border-border-strong bg-bg px-3 py-3 focus-within:border-ring">
        <EditorContent editor={editor} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">
          {t("media.note.count", {
            count: marks.chars.toLocaleString(lang),
            max: NOTE_MAX_CHARS.toLocaleString(lang),
          })}
        </span>
        <NoteSaveStatus state={state} onRetry={flush} t={t} />
      </div>
    </>
  );
}
