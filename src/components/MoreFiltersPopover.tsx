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

/** Unix seconds → local YYYY-MM-DD for a date input's value. */
function toDateInput(sec: number | undefined): string {
  if (sec == null) return "";
  const d = new Date(sec * 1000);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Date-input value → Unix seconds at local start/end of that day. */
function fromDateInput(
  value: string,
  edge: "start" | "end",
): number | undefined {
  if (!value) return undefined;
  const t = new Date(`${value}T${edge === "start" ? "00:00:00" : "23:59:59"}`);
  const sec = Math.floor(t.getTime() / 1000);
  return Number.isFinite(sec) ? sec : undefined;
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

interface Props {
  value: SearchQuery;
  onChange: (query: SearchQuery) => void;
  /** How many conditions inside this panel are active. 0 hides the badge. */
  collapsedCount: number;
  /** Whether anything at all is filtering, for the clear-all action. */
  hasConditions: boolean;
}

export function MoreFiltersPopover({
  value,
  onChange,
  collapsedCount,
  hasConditions,
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
          <SegmentedControl
            slot="play-state-group"
            label={t("filter.playState")}
            value={value.played}
            options={[
              { value: undefined, label: t("filter.all") },
              { value: true, label: t("filter.played") },
              { value: false, label: t("filter.unplayed") },
            ]}
            onChange={(played) => patch({ played })}
          />
        </Section>

        <Section label={t("filter.sortSection")}>
          <div className="flex items-center gap-1.5">
            <Select
              open={sortOpen}
              onOpenChange={setSortOpen}
              value={sort}
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
                {Object.keys(SORT_KEYS).map((key) => (
                  <SelectItem key={key} value={key}>
                    {sortLabel(t, key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() =>
                patch({ sortDir: sortDir === "asc" ? "desc" : "asc" })
              }
              title={sortDir === "asc" ? t("sort.asc") : t("sort.desc")}
              aria-label={sortDir === "asc" ? t("sort.asc") : t("sort.desc")}
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted transition-colors hover:text-fg"
            >
              <SortDirIcon className="size-4" />
            </button>
          </div>
        </Section>

        <Section label={t("filter.btime")}>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={toDateInput(value.btimeFrom)}
              max={toDateInput(value.btimeTo) || undefined}
              aria-label={t("filter.dateFrom")}
              onChange={(e) =>
                patch({ btimeFrom: fromDateInput(e.target.value, "start") })
              }
              className="min-w-0 flex-1"
            />
            <span className="text-muted">–</span>
            <Input
              type="date"
              value={toDateInput(value.btimeTo)}
              min={toDateInput(value.btimeFrom) || undefined}
              aria-label={t("filter.dateTo")}
              onChange={(e) =>
                patch({ btimeTo: fromDateInput(e.target.value, "end") })
              }
              className="min-w-0 flex-1"
            />
          </div>
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
            onClick={() => onChange({})}
            className="h-8 text-xs text-muted underline-offset-2 transition-colors hover:text-fg hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            {t("home.clearAll")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
