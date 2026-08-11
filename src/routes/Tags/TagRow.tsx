import { Pencil, Trash2 } from "lucide-react";
import type { TagSummary } from "@/ipc/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TagChipLabel } from "@/components/TagChipLabel";
import { cn } from "@/lib/utils";
import { tagColorClass } from "@/lib/tagColorClass";
import { tagHumanLabel, tagSourceLabel } from "@/lib/tagLabel";
import { useI18n } from "@/i18n/I18nProvider";

export function TagRow({
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
    <li className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-fg/5">
      {editable ? (
        <input
          type="checkbox"
          className="size-3.5 shrink-0 accent-primary"
          checked={selected}
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
}
