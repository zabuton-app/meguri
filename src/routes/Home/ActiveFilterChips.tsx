import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TFunc } from "@/i18n/I18nProvider";

export type ChipEntry = { key: string; label: string; clear: () => void };

export function ActiveFilterChips({
  chips,
  onClearAll,
  t,
}: {
  chips: ChipEntry[];
  onClearAll: () => void;
  t: TFunc;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
      {chips.map((chip) => (
        <Badge key={chip.key} variant="secondary" className="pr-1">
          {chip.label}
          <button
            type="button"
            onClick={chip.clear}
            aria-label={t("home.removeChip")}
            className="ml-0.5 rounded-full p-0.5 transition hover:bg-fg/15"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
      >
        {t("home.clearAll")}
      </button>
    </div>
  );
}
