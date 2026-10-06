// Cross-search filter controls. The primary row holds what gets reached for
// constantly — text, kind, rating, favorites — and everything rarer collapses
// into MoreFiltersPopover, which reports how many of its conditions are on.
import { useMemo } from "react";
import { CalendarDays, Heart } from "lucide-react";
import type { SearchQuery } from "@/ipc/types";
import { cn } from "@/lib/utils";
import {
  collapsedConditionCount,
  clearAllTarget,
  describeConditions,
} from "@/lib/searchConditions";
import { ActiveFilterChips } from "./ActiveFilterChips";
import { RatingStars } from "./RatingStars";
import { SearchTokenInput } from "./SearchTokenInput";
import { SegmentedControl } from "./SegmentedControl";
import { MoreFiltersPopover } from "./MoreFiltersPopover";
import { useI18n } from "@/i18n/I18nProvider";
import { SmartCollectionsMenu } from "./SmartCollectionsMenu";
import { useSmartCollections } from "@/hooks/useSmartCollections";
import type { SmartCollection } from "@/lib/smartCollections";

interface Props {
  value: SearchQuery;
  onChange: (q: SearchQuery) => void;
  /** True while a collection is active, which is where manual ordering applies. */
  manualSortAvailable?: boolean;
  /**
   * Set while the view orders the list itself (the timeline): the sort
   * control is shown switched off, with this as the reason.
   */
  sortNote?: string;
  /** The real workspace shown, which a saved folder condition belongs to. */
  workspaceId?: string | null;
  /** Opens a saved search; by default its query simply replaces `value`. */
  onApplySaved?: (collection: SmartCollection) => void;
  /**
   * Shows or hides the heatmap panel under the bar. The button sits with the
   * conditions because that is what the panel is: a way to set a date range.
   * Left out, the button is not drawn.
   */
  onToggleHeatmap?: () => void;
  heatmapOpen?: boolean;
}

export function FilterBar({
  value,
  onChange,
  manualSortAvailable,
  sortNote,
  workspaceId,
  onApplySaved,
  onToggleHeatmap,
  heatmapOpen = false,
}: Props) {
  const { t } = useI18n();
  const patch = (p: Partial<SearchQuery>) => onChange({ ...value, ...p });

  const smart = useSmartCollections();
  const { defaultQuery } = smart;
  // "Clear all" returns to the default saved search, if one is set.
  const clearAll = () => onChange(clearAllTarget(value, defaultQuery));

  const descriptors = useMemo(
    () => describeConditions(value, t, defaultQuery),
    [value, t, defaultQuery],
  );
  const collapsedCount = collapsedConditionCount(descriptors);

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-bg px-4 py-2">
      <div className="flex flex-wrap items-center gap-3">
        {/* grow + a non-zero basis (flex-1 would zero it): with a 0 basis this box
          never counts toward a row's width, so the wrapping bar never breaks a
          line and the fixed-width controls squeeze the input down to nothing.
          min-w-0 stays so it can still shrink below the basis when one row is
          all we get. */}
        <div className="flex min-w-0 grow basis-48 items-center">
          <SearchTokenInput
            id="list-search-input"
            value={value.q ?? ""}
            onChange={(q) => patch({ q: q || undefined })}
            placeholder={t("filter.searchPlaceholder")}
            title={t("filter.searchHint")}
          />
        </div>

        <SegmentedControl
          slot="kind-group"
          label={t("filter.kindFilter")}
          value={value.kind || undefined}
          options={[
            { value: undefined, label: t("filter.all") },
            { value: "video", label: t("kind.video") },
            { value: "image", label: t("kind.image") },
            { value: "audio", label: t("kind.audio") },
          ]}
          onChange={(kind) => patch({ kind })}
        />

        <div
          className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2"
          title={t("filter.ratingFilter")}
        >
          <RatingStars
            value={value.ratingMin ?? 0}
            onChange={(r) => patch({ ratingMin: r || undefined })}
            size={14}
          />
        </div>

        <button
          type="button"
          onClick={() => patch({ favorite: value.favorite ? undefined : true })}
          aria-pressed={!!value.favorite}
          title={t("favorite.filter")}
          aria-label={t("favorite.filter")}
          className={cn(
            "flex size-8 items-center justify-center rounded-md border border-border transition-colors",
            value.favorite
              ? "border-error/50 bg-error/10 text-error"
              : "text-muted hover:text-error",
          )}
        >
          <Heart className={cn("size-4", value.favorite && "fill-current")} />
        </button>

        {onToggleHeatmap && (
          <button
            type="button"
            onClick={onToggleHeatmap}
            aria-pressed={heatmapOpen}
            title={t("view.heatmap")}
            aria-label={t("view.heatmap")}
            className={cn(
              "flex size-8 items-center justify-center rounded-md border border-border transition-colors",
              heatmapOpen
                ? "border-primary bg-primary/20 text-fg"
                : "text-muted hover:text-fg",
            )}
          >
            <CalendarDays className="size-4" />
          </button>
        )}

        <MoreFiltersPopover
          value={value}
          onChange={onChange}
          collapsedCount={collapsedCount}
          hasConditions={descriptors.length > 0}
          onClearAll={clearAll}
          manualSortAvailable={manualSortAvailable}
          sortNote={sortNote}
        />

        {/* Pushed to the far end: saved searches are a way *into* a set of
            conditions, not one more condition to set. */}
        <div className="ml-auto">
          <SmartCollectionsMenu
            value={value}
            workspaceId={workspaceId}
            onApply={onApplySaved ?? ((c) => onChange(c.query))}
            smart={smart}
          />
        </div>
      </div>

      <ActiveFilterChips
        chips={descriptors.filter((d) => d.chip)}
        onRemove={(chip) => onChange(chip.clear(value))}
        onClearAll={clearAll}
        t={t}
      />
    </div>
  );
}
