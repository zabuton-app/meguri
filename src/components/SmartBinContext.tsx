import { Bookmark, X } from "lucide-react";
import type { SearchQuery } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import {
  describeSearchQuery,
  type SmartCollection,
} from "@/lib/smartCollections";
import { heldFilterEntries } from "@/lib/heldFilters";

/** Bin membership stays visible independently of the visitor's editable filters. */
export function SmartBinContext({
  bin,
  omitted,
  onLeave,
  activeFilters,
  onEnableFilter,
  onRemoveFilter,
}: {
  bin: SmartCollection;
  omitted?: SearchQuery;
  onLeave: () => void;
  activeFilters: SearchQuery;
  onEnableFilter: (patch: SearchQuery) => void;
  onRemoveFilter: (clear: (query: SearchQuery) => SearchQuery) => void;
}) {
  const { t } = useI18n();
  const held = heldFilterEntries(omitted ?? {}, bin.query, activeFilters, t);
  return (
    <div
      data-slot="smart-bin-context"
      className="space-y-2 border-b-2 border-primary bg-surface px-4 py-3 text-sm text-bright-fg"
    >
      <div className="flex items-start gap-2">
        <Bookmark className="mt-1 size-4 shrink-0 text-primary" />
        <strong className="min-w-0 break-words rounded bg-primary px-2 py-0.5 text-primary-foreground">
          {bin.name}
        </strong>
        <span
          className="min-w-0 flex-1 whitespace-normal break-words py-0.5 font-semibold text-bright-fg"
          title={describeSearchQuery(t, bin.query)}
        >
          {describeSearchQuery(t, bin.query)}
        </span>
        <button
          type="button"
          onClick={onLeave}
          className="ml-auto shrink-0 rounded p-1 hover:bg-overlay"
          aria-label={t("smartBin.leave")}
          title={t("smartBin.leave")}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {held.length > 0 && (
        <div
          data-slot="held-filters"
          className="space-y-2 rounded-md border border-border-strong bg-bg p-2"
        >
          <p className="font-semibold text-bright-fg">
            {t("smartBin.inactiveFilters")}
          </p>
          <p className="text-sm text-fg">{t("smartBin.pausedResultsHint")}</p>
          <div className="flex flex-wrap gap-2">
            {held.map((filter) => (
              <div key={filter.key} className="flex items-stretch gap-1">
                <button
                  type="button"
                  role="switch"
                  aria-checked={false}
                  aria-label={t("smartBin.enableFilter", {
                    filter: filter.label,
                  })}
                  disabled={!filter.available}
                  data-filter-state={filter.available ? "off" : "unavailable"}
                  title={t(
                    filter.available
                      ? "smartBin.offHint"
                      : "smartBin.unavailableHint",
                  )}
                  onClick={() => onEnableFilter(filter.patch)}
                  className={
                    filter.available
                      ? "flex items-center gap-2 rounded border border-border-strong bg-surface px-2 py-1 text-sm font-medium text-bright-fg hover:border-primary"
                      : "flex cursor-not-allowed items-center gap-2 rounded border border-dashed border-border-strong bg-surface px-2 py-1 text-sm font-medium text-bright-fg"
                  }
                >
                  <span>{filter.label}</span>
                  <span className="rounded bg-overlay px-1.5 py-0.5 text-xs font-bold text-bright-fg">
                    {t(
                      filter.available
                        ? "smartBin.off"
                        : "smartBin.unavailable",
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t("smartBin.removeHeld", {
                    filter: filter.label,
                  })}
                  title={t("smartBin.removeHeld", { filter: filter.label })}
                  onClick={() => onRemoveFilter(filter.clear)}
                  className="rounded border border-border-strong px-2 text-bright-fg hover:bg-overlay"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
