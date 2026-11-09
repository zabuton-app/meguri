import { memo } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { TagSummary } from "@/ipc/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TagChipLabel } from "@/components/TagChipLabel";
import { cn } from "@/lib/utils";
import { tagColorClass } from "@/lib/tagColorClass";
import { tagHumanLabel, tagSourceLabel } from "@/lib/tagLabel";
import { useI18n } from "@/i18n/I18nProvider";

// Memoized so ticking one box re-renders only that row: the list holds up to
// MAX_TAG_LIST rows, and the screen passes stable callbacks.
export const TagRow = memo(function TagRow({
  tag,
  selected,
  busy,
  onToggleSelect,
  onFilter,
  onRename,
  onDelete,
}: {
  tag: TagSummary;
  selected: boolean;
  /** A catalog mutation is in flight; the row's actions are blocked meanwhile. */
  busy: boolean;
  onToggleSelect: (tag: TagSummary) => void;
  onFilter: (tag: TagSummary) => void;
  onRename: (tag: TagSummary) => void;
  onDelete: (tag: TagSummary) => void;
}) {
  const { t } = useI18n();
  // Pipeline-owned tags are rewritten on every scan, so there is nothing to edit.
  const editable = !tag.pipelineOwned;
  const primarySource = tag.bySource[0]?.source ?? "manual";

  return (
    // content-visibility: rows scrolled out of view skip style, layout and
    // paint, and stand in at the intrinsic size until laid out once (`auto`
    // remembers the real one after that). The size is the content box, inside
    // the py-1: an editable row is as tall as its h-7 buttons; a read-only one
    // has no buttons, and its source badge is the tallest thing in it.
    <li
      className={cn(
        "flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-fg/5 [content-visibility:auto]",
        editable
          ? "[contain-intrinsic-size:auto_1.75rem]"
          : "[contain-intrinsic-size:auto_1.3125rem]",
      )}
    >
      {editable ? (
        <input
          type="checkbox"
          className="size-3.5 shrink-0 accent-primary disabled:opacity-50"
          checked={selected}
          // A mutation is in flight against this selection; letting it change
          // underneath would aim the next action at a different set of tags.
          disabled={busy}
          onChange={() => onToggleSelect(tag)}
          aria-label={tag.qualified}
        />
      ) : (
        <span className="size-3.5 shrink-0" />
      )}

      <button
        type="button"
        onClick={() => onFilter(tag)}
        title={t("tags.filterByTag")}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-xs leading-4",
            tagColorClass(primarySource),
          )}
        >
          <TagChipLabel namespace={tag.namespace} name={tag.name} />
        </span>
        {tag.namespace && (
          <span className="truncate text-xs text-muted">
            {tagHumanLabel(t, tag.namespace, tag.name)}
          </span>
        )}
      </button>

      <span className="flex shrink-0 items-center gap-1">
        {tag.bySource.map((s) => (
          <Badge key={s.source} variant="outline" className="text-[10px]">
            {tagSourceLabel(t, s.source)}
          </Badge>
        ))}
      </span>
      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted">
        {t("tags.fileCount", { count: tag.fileCount })}
      </span>

      {editable && (
        <span className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={busy}
            onClick={() => onRename(tag)}
            aria-label={t("tags.rename")}
            title={t("tags.rename")}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={busy}
            onClick={() => onDelete(tag)}
            aria-label={t("tags.delete")}
            title={t("tags.delete")}
          >
            <Trash2 />
          </Button>
        </span>
      )}
    </li>
  );
});
