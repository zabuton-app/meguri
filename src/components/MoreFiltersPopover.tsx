// The collapsed half of the filter bar: play state, sort order, creation-date
// range, and duplicates. They live behind one trigger so the primary row stays
// short, and the trigger carries a count of how many of them are active — a
// condition folded out of sight still has to announce itself.
import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  CopyCheck,
  SlidersHorizontal,
  SortAsc,
  SortDesc,
} from "lucide-react";
import { resolveSortDir } from "@shared/sortDir";
import type { SearchQuery } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { toggleDuplicatesPatch } from "@/lib/duplicatesFilter";
import { MANUAL_SORT } from "@shared/sortDir";
import { SORT_KEYS, sortLabel } from "@/lib/sortLabel";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl } from "./SegmentedControl";
import { useI18n } from "@/i18n/I18nProvider";
import { DATE_RANGES, fromDateInput, toDateInput } from "@/lib/dateRanges";

type PlayState = "all" | "played" | "inProgress" | "unplayed";

/** The segment a query selects. "In progress" is its own field (a file can be
 *  both played and in progress), so the two are folded into one choice here. */
function playStateOf(query: SearchQuery): PlayState {
  if (query.inProgress) return "inProgress";
  if (query.played === true) return "played";
  if (query.played === false) return "unplayed";
  return "all";
}

/** The query fields a segment sets; each choice clears the other field. */
function playStatePatch(
  state: PlayState,
): Pick<SearchQuery, "played" | "inProgress"> {
  return {
    played:
      state === "played" ? true : state === "unplayed" ? false : undefined,
    inProgress: state === "inProgress" ? true : undefined,
  };
}

function Section({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="text-xs font-medium tracking-wide text-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

/** Two date inputs for a range whose ends are both included; each bounds the other. */
function DateRangeSection({
  label,
  from,
  to,
  fromLabel,
  toLabel,
  onChange,
}: {
  label: string;
  from: number | undefined;
  to: number | undefined;
  fromLabel: string;
  toLabel: string;
  onChange: (range: {
    from: number | undefined;
    to: number | undefined;
  }) => void;
}) {
  return (
    <Section label={label}>
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={toDateInput(from)}
          max={toDateInput(to) || undefined}
          aria-label={`${label}: ${fromLabel}`}
          onChange={(e) =>
            onChange({ from: fromDateInput(e.target.value, "start"), to })
          }
          className="min-w-0 flex-1"
        />
        <span className="text-muted">–</span>
        <Input
          type="date"
          value={toDateInput(to)}
          min={toDateInput(from) || undefined}
          aria-label={`${label}: ${toLabel}`}
          onChange={(e) =>
            onChange({ from, to: fromDateInput(e.target.value, "end") })
          }
          className="min-w-0 flex-1"
        />
      </div>
    </Section>
  );
}

interface Props {
  value: SearchQuery;
  onChange: (query: SearchQuery) => void;
  /** How many conditions inside this panel are active. 0 hides the badge. */
  collapsedCount: number;
  /** Whether anything at all is filtering, for the clear-all action. */
  hasConditions: boolean;
  /** Clears every condition (to the default saved search, if one is set). */
  onClearAll: () => void;
  /** True while a collection is active: only then is there a manual order to sort by. */
  manualSortAvailable?: boolean;
  /** The view orders the list itself: the sort is switched off, for this reason. */
  sortNote?: string;
}

export function MoreFiltersPopover({
  value,
  onChange,
  collapsedCount,
  hasConditions,
  onClearAll,
  manualSortAvailable = false,
  sortNote,
}: Props) {
  const { t } = useI18n();
  const patch = (p: Partial<SearchQuery>) => onChange({ ...value, ...p });
  // The sort select is controlled purely so Escape can be routed correctly:
  // while it is open the popover's dismiss layer still owns the key and would
  // close the whole panel, when the user only meant to back out of the dropdown.
  const [sortOpen, setSortOpen] = useState(false);
  const sort = value.sort ?? "added";
  const sortDir = resolveSortDir(sort, value.sortDir);
  const SortDirIcon = sortDir === "asc" ? SortAsc : SortDesc;
  // Manual order is the collection's stored item order, so it is offered only
  // where such an order exists to follow.
  const sortKeys = Object.keys(SORT_KEYS).filter(
    (key) => key !== MANUAL_SORT || manualSortAvailable,
  );
  const active = collapsedCount > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="more-filters-trigger"
          title={t("filter.more")}
          aria-label={
            active
              ? t("filter.moreActive", { count: collapsedCount })
              : t("filter.more")
          }
          className={cn(
            "group flex h-8 items-center gap-1 rounded-md border px-2 text-sm transition-colors",
            active
              ? "border-primary/50 bg-primary/10 text-fg"
              : "border-border text-muted hover:text-fg",
            "data-[state=open]:border-primary/50 data-[state=open]:bg-primary/10 data-[state=open]:text-fg",
          )}
        >
          {/* Icon only — the label lives in the accessible name and the tooltip,
              so the trigger stays the width of the other icon buttons. */}
          <SlidersHorizontal className="size-4" />
          {active && (
            <span
              data-slot="more-filters-badge"
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] font-medium text-primary-foreground"
            >
              {collapsedCount}
            </span>
          )}
          <ChevronDown className="size-3 opacity-60 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        data-slot="more-filters-panel"
        aria-label={t("filter.more")}
        onEscapeKeyDown={(event) => {
          if (!sortOpen) return;
          // The sort dropdown is open: swallow the key so the panel survives,
          // and close the dropdown ourselves since it never received the event.
          event.preventDefault();
          setSortOpen(false);
        }}
        // Wide enough that the two date inputs sit in one column without their
        // mm/dd/yyyy placeholder touching the frame, and still capped so a
        // narrow window never pushes it off-screen.
        className="grid w-[min(34rem,calc(100vw-2rem))] grid-cols-2 gap-x-5 gap-y-3.5"
      >
        {/* Full width: three labels side by side outgrow half the panel in the
            wordier locales. */}
        <Section label={t("filter.playState")} className="col-span-2">
          <SegmentedControl<PlayState>
            slot="play-state-group"
            label={t("filter.playState")}
            value={playStateOf(value)}
            options={[
              { value: "all", label: t("filter.all") },
              { value: "played", label: t("filter.played") },
              { value: "inProgress", label: t("filter.inProgress") },
              { value: "unplayed", label: t("filter.unplayed") },
            ]}
            onChange={(state) => patch(playStatePatch(state))}
          />
        </Section>

        {/* The date ranges come first and in pairs, so they line up two to a
            row; the sort and the rest close the panel. */}
        {DATE_RANGES.map(({ label, from, to }) => (
          <DateRangeSection
            key={from}
            label={t(label)}
            from={value[from]}
            to={value[to]}
            fromLabel={t("filter.dateFrom")}
            toLabel={t("filter.dateTo")}
            onChange={(range) => patch({ [from]: range.from, [to]: range.to })}
          />
        ))}

        <Section label={t("filter.sortSection")}>
          <div className="flex items-center gap-1.5">
            <Select
              open={sortOpen}
              onOpenChange={setSortOpen}
              value={sort}
              disabled={!!sortNote}
              onValueChange={(v) =>
                patch({
                  sort: v === "added" ? undefined : v,
                  sortDir: undefined,
                })
              }
            >
              <SelectTrigger className="min-w-0 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortKeys.map((key) => (
                  <SelectItem key={key} value={key}>
                    {sortLabel(t, key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Manual order is the collection's own arrangement; there is no
                direction to reverse, and searchCollectionManual ignores it. */}
            {sort !== MANUAL_SORT && (
              <button
                type="button"
                onClick={() =>
                  patch({ sortDir: sortDir === "asc" ? "desc" : "asc" })
                }
                disabled={!!sortNote}
                title={sortDir === "asc" ? t("sort.asc") : t("sort.desc")}
                aria-label={sortDir === "asc" ? t("sort.asc") : t("sort.desc")}
                className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SortDirIcon className="size-4" />
              </button>
            )}
          </div>
          {sortNote ? (
            <p className="mt-1.5 text-xs text-muted">{sortNote}</p>
          ) : (
            manualSortAvailable &&
            sort !== MANUAL_SORT && (
              <p className="mt-1.5 text-xs text-muted">
                {t("playlist.reorderNeedsManual")}
              </p>
            )
          )}
        </Section>

        <Section label={t("filter.otherSection")}>
          <div>
            <button
              type="button"
              onClick={() => patch(toggleDuplicatesPatch(value))}
              aria-pressed={!!value.duplicates}
              title={t("duplicates.filter")}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                value.duplicates
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted hover:text-fg",
              )}
            >
              <CopyCheck className="size-4" />
              {t("duplicates.chip")}
            </button>
          </div>
        </Section>

        <div className="flex items-end justify-end">
          <button
            type="button"
            disabled={!hasConditions}
            onClick={onClearAll}
            className="h-8 text-xs text-muted underline-offset-2 transition-colors hover:text-fg hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            {t("home.clearAll")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
