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
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import {
  Bold,
  Check,
  CircleAlert,
  Code,
  Heading,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  LoaderCircle,
  Pencil,
  Plus,
  Strikethrough,
  TextQuote,
  type LucideIcon,
} from "lucide-react";
import log from "@/lib/logger";
import { api } from "@/ipc/client";
import { useI18n, type TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import { useNoteWriter, type SaveState } from "./useNoteWriter";
import { NoteLink, NoteParagraph } from "./noteExtensions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { NOTE_MAX_CHARS, normalizeNote } from "@shared/note";

/** Height (px) above which a note is shown collapsed until "Show all". */
const COLLAPSED_PX = 240;

/** Links in a note are http(s) only; that is all a note link opens to. */
function isAllowedLink(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * An address typed without a scheme (`example.com`, `localhost:3000`) is
 * taken as https. Only `scheme://` counts as a scheme, so a host with a port
 * is not mistaken for one.
 */
function withScheme(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

function noteOf(editor: Editor): string | null {
  return normalizeNote(editor.isEmpty ? null : editor.getMarkdown());
}

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
  const { state, schedule, flush, adopt } = useNoteWriter(fileId, wsId, note);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

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
      extensions: [
        StarterKit.configure({
          // Markdown has no underline.
          underline: false,
          // Replaced below by ones that keep what the user wrote.
          paragraph: false,
          link: false,
        }),
        NoteParagraph,
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
        Placeholder.configure({ placeholder: t("media.note.placeholder") }),
      ],
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
        handleDOMEvents: {
          click: (view, event) => {
            const a = (event.target as HTMLElement | null)?.closest?.(
              "a[href]",
            );
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
          },
        },
      },
      onUpdate: ({ editor: e }) => schedule(noteOf(e)),
      onBlur: flush,
    },
    [shown],
  );

  const view = useEditorState({
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

  const startEditing = () => {
    setEditing(true);
    setExpanded(true);
  };
  useEffect(() => {
    editor.setEditable(editing, false);
    if (editing) editor.commands.focus("end");
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
    <section
      aria-label={t("media.note")}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-surface p-4",
        editing ? "border-primary" : "border-border",
      )}
    >
      <div className="flex min-h-8 items-center gap-2">
        <span className="text-xs font-semibold uppercase text-muted">
          {t("media.note")}
        </span>
        <SaveStatus state={state} onRetry={flush} t={t} />
        {!editing && !view.isEmpty && (
          <Button
            variant="outline"
            size="sm"
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
          className="flex h-14 items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-sm text-muted hover:bg-accent hover:text-accent-foreground"
        >
          <Plus className="size-4" />
          {t("media.note.add")}
        </button>
      )}

      {editing && <Toolbar editor={editor} active={view} t={t} />}

      <div
        ref={contentRef}
        hidden={showAdd}
        className={cn(
          "relative",
          editing &&
            "min-h-40 rounded-lg border border-border-strong bg-background px-3.5 py-3",
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
          size="sm"
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
            size="sm"
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

function SaveStatus({
  state,
  onRetry,
  t,
}: {
  state: SaveState;
  onRetry: () => void;
  t: TFunc;
}) {
  if (state === "idle") return null;
  if (state === "error") {
    return (
      <span
        role="status"
        className="flex items-center gap-2 text-xs text-error"
      >
        <CircleAlert className="size-3.5" aria-hidden />
        {t("media.note.saveFailed")}
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2"
          onClick={onRetry}
        >
          {t("media.note.retry")}
        </Button>
      </span>
    );
  }
  return (
    <span
      role="status"
      className={cn(
        "flex items-center gap-1 text-xs",
        state === "saved" ? "text-success" : "text-muted",
      )}
    >
      {state === "saving" ? (
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Check className="size-3.5" aria-hidden />
      )}
      {state === "saving" ? t("media.note.saving") : t("media.note.saved")}
    </span>
  );
}

interface ActiveMarks {
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

function Toolbar({
  editor,
  active,
  t,
}: {
  editor: Editor;
  active: ActiveMarks;
  t: TFunc;
}) {
  const items: {
    key: keyof ActiveMarks;
    label: TranslationKey;
    icon: LucideIcon;
    run: () => void;
  }[][] = [
    [
      {
        key: "heading",
        label: "media.note.heading",
        icon: Heading,
        // Pressed for any level, so a press on any heading (a loaded `# `
        // too) removes it rather than changing its level.
        run: () =>
          editor.isActive("heading")
            ? editor.chain().focus().setParagraph().run()
            : editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      {
        key: "bold",
        label: "media.note.bold",
        icon: Bold,
        run: () => editor.chain().focus().toggleBold().run(),
      },
      {
        key: "italic",
        label: "media.note.italic",
        icon: Italic,
        run: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        key: "strike",
        label: "media.note.strike",
        icon: Strikethrough,
        run: () => editor.chain().focus().toggleStrike().run(),
      },
      {
        key: "code",
        label: "media.note.code",
        icon: Code,
        run: () => editor.chain().focus().toggleCode().run(),
      },
    ],
    [
      {
        key: "bulletList",
        label: "media.note.bulletList",
        icon: List,
        run: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        key: "orderedList",
        label: "media.note.orderedList",
        icon: ListOrdered,
        run: () => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        key: "taskList",
        label: "media.note.taskList",
        icon: ListTodo,
        run: () => editor.chain().focus().toggleTaskList().run(),
      },
      {
        key: "blockquote",
        label: "media.note.quote",
        icon: TextQuote,
        run: () => editor.chain().focus().toggleBlockquote().run(),
      },
    ],
  ];

  return (
    <div
      role="toolbar"
      aria-label={t("media.note.toolbar")}
      className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-background p-1"
    >
      {items.map((group, i) => (
        <div key={i} className="flex items-center gap-0.5">
          {i > 0 && <span aria-hidden className="mx-1 h-5 w-px bg-border" />}
          {group.map(({ key, label, icon: Icon, run }) => (
            <Button
              key={key}
              type="button"
              variant="ghost"
              size="icon"
              className={cn("size-8", active[key] && "bg-accent")}
              aria-label={t(label)}
              aria-pressed={active[key]}
              title={t(label)}
              // Keep the editor's selection: a click would otherwise move focus.
              onMouseDown={(e) => e.preventDefault()}
              onClick={run}
            >
              <Icon />
            </Button>
          ))}
        </div>
      ))}
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      <LinkButton editor={editor} active={active.link} t={t} />
    </div>
  );
}

function LinkButton({
  editor,
  active,
  t,
}: {
  editor: Editor;
  active: boolean;
  t: TFunc;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  const onOpenChange = (next: boolean) => {
    if (next) {
      setUrl((editor.getAttributes("link").href as string | undefined) ?? "");
    }
    setOpen(next);
  };

  const apply = () => {
    const typed = url.trim();
    const href = withScheme(typed);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (typed === "") {
      chain.unsetLink().run();
    } else if (!isAllowedLink(href)) {
      // setLink checks this itself; inserting a mark by hand does not.
      return;
    } else if (editor.state.selection.empty && !editor.isActive("link")) {
      // Nothing selected: insert the address itself as the link text.
      chain
        .insertContent({
          type: "text",
          text: typed,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      chain.setLink({ href }).run();
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-8", active && "bg-accent")}
          aria-label={t("media.note.link")}
          aria-pressed={active}
          title={t("media.note.link")}
          onMouseDown={(e) => e.preventDefault()}
        >
          <LinkIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            aria-label={t("media.note.linkUrl")}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            {active && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .unsetLink()
                    .run();
                  setOpen(false);
                }}
              >
                {t("media.note.linkRemove")}
              </Button>
            )}
            <Button type="submit" size="sm">
              {t("media.note.linkApply")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
