// Cross-search filter controls. q / kind / play state / creation date / minimum rating / favorite / duplicates / sort order.
import {
  CalendarDays,
  CopyCheck,
  Heart,
  Search,
  SortAsc,
  SortDesc,
} from "lucide-react";
import { resolveSortDir } from "@shared/sortDir";
import type { SearchQuery } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { toggleDuplicatesPatch } from "@/lib/duplicatesFilter";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RatingStars } from "./RatingStars";
import { useI18n } from "@/i18n/I18nProvider";
import { SmartCollectionsMenu } from "./SmartCollectionsMenu";

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

interface Props {
  value: SearchQuery;
  onChange: (q: SearchQuery) => void;
}

export function FilterBar({ value, onChange }: Props) {
  const { t } = useI18n();
  const patch = (p: Partial<SearchQuery>) => onChange({ ...value, ...p });
  const sortLabel = (key: Parameters<typeof t>[0]) =>
    t("filter.sortLabel", { label: t(key) });
  const sort = value.sort ?? "added";
  const sortDir = resolveSortDir(sort, value.sortDir);
  const SortDirIcon = sortDir === "asc" ? SortAsc : SortDesc;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-bg px-4 py-2">
      <div className="relative flex min-w-0 flex-1 items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-muted" />
        <Input
          id="list-search-input"
          value={value.q ?? ""}
          onChange={(e) => patch({ q: e.target.value || undefined })}
          onKeyDown={(e) => {
            // Esc / Enter drop focus (so list shortcuts work again). Stop Esc from
            // bubbling to modal/overlay Esc handlers.
            if (e.key === "Escape") {
              e.stopPropagation();
              e.currentTarget.blur();
            } else if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          placeholder={t("filter.searchPlaceholder")}
          className="pl-7"
        />
      </div>

      <Select
        value={value.kind ?? "all"}
        onValueChange={(v) => patch({ kind: v === "all" ? undefined : v })}
      >
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filter.all")}</SelectItem>
          <SelectItem value="video">{t("kind.video")}</SelectItem>
          <SelectItem value="image">{t("kind.image")}</SelectItem>
          <SelectItem value="audio">{t("kind.audio")}</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={
          value.played == null ? "all" : value.played ? "played" : "unplayed"
        }
        onValueChange={(v) =>
          patch({ played: v === "all" ? undefined : v === "played" })
        }
      >
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filter.playAny")}</SelectItem>
          <SelectItem value="played">{t("filter.played")}</SelectItem>
          <SelectItem value="unplayed">{t("filter.unplayed")}</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Select
          value={sort}
          onValueChange={(v) =>
            patch({ sort: v === "added" ? undefined : v, sortDir: undefined })
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="added">{sortLabel("sort.added")}</SelectItem>
            <SelectItem value="name">{sortLabel("sort.name")}</SelectItem>
            <SelectItem value="rating">{sortLabel("sort.rating")}</SelectItem>
            <SelectItem value="captured">
              {sortLabel("sort.captured")}
            </SelectItem>
            <SelectItem value="btime">{sortLabel("filter.btime")}</SelectItem>
            <SelectItem value="accessed">
              {sortLabel("sort.accessed")}
            </SelectItem>
            <SelectItem value="hash">{sortLabel("sort.hash")}</SelectItem>
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => patch({ sortDir: sortDir === "asc" ? "desc" : "asc" })}
          title={sortDir === "asc" ? t("sort.asc") : t("sort.desc")}
          aria-label={sortDir === "asc" ? t("sort.asc") : t("sort.desc")}
          className="flex size-8 items-center justify-center rounded-md border border-border text-muted transition-colors hover:text-fg"
        >
          <SortDirIcon className="size-4" />
        </button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-pressed={value.btimeFrom != null || value.btimeTo != null}
            title={t("filter.btimeFilter")}
            aria-label={t("filter.btimeFilter")}
            className={cn(
              "flex size-8 items-center justify-center rounded-md border border-border transition-colors",
              value.btimeFrom != null || value.btimeTo != null
                ? "border-primary/50 bg-primary/10 text-primary"
                : "text-muted hover:text-fg",
            )}
          >
            <CalendarDays className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="p-3">
          <div className="mb-2 text-xs font-medium text-muted">
            {t("filter.btime")}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={toDateInput(value.btimeFrom)}
              max={toDateInput(value.btimeTo) || undefined}
              aria-label={t("filter.dateFrom")}
              onChange={(e) =>
                patch({ btimeFrom: fromDateInput(e.target.value, "start") })
              }
              className="w-36"
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
              className="w-36"
            />
          </div>
          {(value.btimeFrom != null || value.btimeTo != null) && (
            <button
              type="button"
              onClick={() =>
                patch({ btimeFrom: undefined, btimeTo: undefined })
              }
              className="mt-2 text-xs text-muted transition-colors hover:text-fg"
            >
              {t("filter.dateClear")}
            </button>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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

      <button
        type="button"
        onClick={() => patch(toggleDuplicatesPatch(value))}
        aria-pressed={!!value.duplicates}
        title={t("duplicates.filter")}
        aria-label={t("duplicates.filter")}
        className={cn(
          "flex size-8 items-center justify-center rounded-md border border-border transition-colors",
          value.duplicates
            ? "border-primary/50 bg-primary/10 text-primary"
            : "text-muted hover:text-fg",
        )}
      >
        <CopyCheck className="size-4" />
      </button>

      <SmartCollectionsMenu value={value} onApply={onChange} />
    </div>
  );
}
