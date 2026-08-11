// Cross-search filter controls. The primary row holds what gets reached for
// constantly — text, kind, rating, favorites — and everything rarer collapses
// into MoreFiltersPopover, which reports how many of its conditions are on.
import { useMemo } from "react";
import { Heart } from "lucide-react";
import type { SearchQuery } from "@/ipc/types";
import { cn } from "@/lib/utils";
import {
  collapsedConditionCount,
  describeConditions,
} from "@/lib/searchConditions";
import { ActiveFilterChips } from "./ActiveFilterChips";
import { RatingStars } from "./RatingStars";
import { SearchTokenInput } from "./SearchTokenInput";
import { SegmentedControl } from "./SegmentedControl";
import { MoreFiltersPopover } from "./MoreFiltersPopover";
import { useI18n } from "@/i18n/I18nProvider";
import { SmartCollectionsMenu } from "./SmartCollectionsMenu";

interface Props {
  value: SearchQuery;
  onChange: (q: SearchQuery) => void;
}

export function FilterBar({ value, onChange }: Props) {
  const { t } = useI18n();
  const patch = (p: Partial<SearchQuery>) => onChange({ ...value, ...p });

  const descriptors = useMemo(() => describeConditions(value, t), [value, t]);
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

        <MoreFiltersPopover
          value={value}
          onChange={onChange}
          collapsedCount={collapsedCount}
          hasConditions={descriptors.length > 0}
        />

        {/* Pushed to the far end: saved searches are a way *into* a set of
            conditions, not one more condition to set. */}
        <div className="ml-auto">
          <SmartCollectionsMenu value={value} onApply={onChange} />
        </div>
      </div>

      <ActiveFilterChips
        chips={descriptors.filter((d) => d.chip)}
        onRemove={(chip) => onChange(chip.clear(value))}
        onClearAll={() => onChange({})}
        t={t}
      />
    </div>
  );
}
