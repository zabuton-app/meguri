// Read-back row for the filter bar: one chip per active condition, each undoing
// only itself. Rendered inside the filter block, so it appears only when there
// is something to report.
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ConditionDescriptor } from "@/lib/searchConditions";
import type { TFunc } from "@/i18n/I18nProvider";

export function ActiveFilterChips({
  chips,
  onRemove,
  onClearAll,
  t,
}: {
  chips: ConditionDescriptor[];
  onRemove: (chip: ConditionDescriptor) => void;
  onClearAll: () => void;
  t: TFunc;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      {/* The chips scroll rather than wrap, so a long list never pushes the bar
          down over the results. Clear all sits outside the scroller: the way out
          of a filter set must not itself be something you have to scroll to.

          A plain overflow container rather than ScrollArea: this is a single
          row, the same shape the grid/list/table cards already scroll their tag
          rows with. Unlike those, the scrollbar stays visible (thin) — a row
          that silently hides conditions off its right edge is exactly the
          failure this feature exists to avoid. */}
      <div
        data-slot="filter-chip-track"
        className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-hidden pb-1 [scrollbar-width:thin]"
      >
        {chips.map((chip) => (
          <Badge
            key={chip.key}
            data-slot="filter-chip"
            variant="secondary"
            className="max-w-72 pr-1"
          >
            <span className="truncate">{chip.label}</span>
            <button
              type="button"
              onClick={() => onRemove(chip)}
              aria-label={t("home.removeChip")}
              className="ml-0.5 shrink-0 rounded-full p-0.5 transition hover:bg-fg/15"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <button
        type="button"
        onClick={onClearAll}
        className="shrink-0 text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
      >
        {t("home.clearAll")}
      </button>
    </div>
  );
}
