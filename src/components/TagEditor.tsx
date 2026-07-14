// Tag editor. Color-codes badges by source (auto-assigned are read-only, manual can be removed).
import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/ipc/client";
import type { TagInfo } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  tags: TagInfo[];
  /** Workspace whose tags feed completion suggestions. */
  workspaceId: string;
  onAdd: (name: string) => void;
  onRemove: (tagId: number) => void;
}

/** Determines the badge color class from the source. */
function sourceClass(source: string): string {
  if (source === "manual") return "bg-primary text-primary-foreground";
  if (source === "auto-meta") return "bg-info text-bg";
  return "bg-overlay text-fg";
}

export function TagEditor({ tags, workspaceId, onAdd, onRemove }: Props) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const listId = useId();

  // Fetch tag completion suggestions by input prefix (debounced).
  useEffect(() => {
    const v = input.trim();
    if (!v) {
      // Synchronously resetting on input clear, alongside the updates inside the debounced/async fetch, makes setState within this effect legitimate, so it is allowed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .tagsList(workspaceId, v, 8)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 150);
    return () => clearTimeout(t);
  }, [input, workspaceId]);

  const submit = () => {
    const v = input.trim();
    if (v) {
      onAdd(v);
      setInput("");
      setSuggestions([]);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && (
          <span className="text-xs text-muted">{t("tag.none")}</span>
        )}
        {tags.map((tag) => (
          <span
            key={`${tag.id}-${tag.source}`}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs",
              sourceClass(tag.source),
            )}
            title={`source: ${tag.source}`}
          >
            {tag.name}
            {tag.source === "manual" && (
              <button
                type="button"
                onClick={() => onRemove(tag.id)}
                className="hover:opacity-70"
                aria-label={t("tag.remove")}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      <input
        value={input}
        list={listId}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder={t("tag.addPlaceholder")}
        className="h-8 rounded-md border border-border bg-bg px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
