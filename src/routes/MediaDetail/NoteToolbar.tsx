// The note editor's toolbar and save status, shared by the note card and the
// note template in Settings (#345).
import { useState } from "react";
import type { Editor } from "@tiptap/react";
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
  Strikethrough,
  TextQuote,
  type LucideIcon,
} from "lucide-react";
import type { TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import type { SaveState } from "./useNoteWriter";
import { isAllowedLink, withScheme, type ActiveMarks } from "./noteEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function NoteSaveStatus({
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
        <Button variant="outline" size="compact" onClick={onRetry}>
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

export function NoteToolbar({
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
      className="flex flex-wrap items-center gap-0.5 rounded-card border border-border bg-bg p-1"
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
              className={cn("size-7", active[key] && "bg-primary/15")}
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
          className={cn("size-7", active && "bg-primary/15")}
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
