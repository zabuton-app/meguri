// Left pane of the duplicates view: the filter controls and the group list.
// Picking a row shows that group's copies in the detail pane.
import { Search } from "lucide-react";
import type { DuplicateGroup } from "@/ipc/types";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl, type Segment } from "@/components/SegmentedControl";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { useI18n } from "@/i18n/I18nProvider";
import {
  DUPLICATE_SORTS,
  groupKey,
  groupName,
  reclaimableBytes,
  reclaimBarPercent,
  type DuplicateKindFilter,
  type DuplicateSort,
} from "./groupView";

interface Props {
  groups: DuplicateGroup[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Reclaimable bytes of the largest group, the full length of a row's bar. */
  maxReclaimable: number;
  query: string;
  onQueryChange: (query: string) => void;
  kind: DuplicateKindFilter;
  onKindChange: (kind: DuplicateKindFilter) => void;
  sort: DuplicateSort;
  onSortChange: (sort: DuplicateSort) => void;
  mediaBase: string;
  className?: string;
}

export function GroupList({
  groups,
  selectedKey,
  onSelect,
  maxReclaimable,
  query,
  onQueryChange,
  kind,
  onKindChange,
  sort,
  onSortChange,
  mediaBase,
  className,
}: Props) {
  const { t } = useI18n();
  const kinds: Segment<DuplicateKindFilter>[] = [
    { value: "all", label: t("filter.all") },
    { value: "video", label: t("kind.video") },
    { value: "image", label: t("kind.image") },
    { value: "audio", label: t("kind.audio") },
  ];

  return (
    <aside
      className={cn("flex min-h-0 flex-col border-border", className)}
      aria-label={t("duplicates.groupList")}
    >
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <label className="relative block">
          <span className="sr-only">{t("duplicates.search")}</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("duplicates.search")}
            className="pl-7"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={kind}
            options={kinds}
            onChange={onKindChange}
            label={t("filter.kindFilter")}
            slot="duplicates-kind"
          />
          <Select
            value={sort}
            onValueChange={(v) => onSortChange(v as DuplicateSort)}
          >
            <SelectTrigger
              className="ml-auto h-8 min-w-36"
              aria-label={t("duplicates.sortLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DUPLICATE_SORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`duplicates.sort.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted">
          {t("duplicates.noMatch")}
        </p>
      ) : (
        <ul className="page-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {groups.map((g) => {
            const key = groupKey(g);
            const selected = key === selectedKey;
            const reclaim = reclaimableBytes(g);
            const pct = reclaimBarPercent(reclaim, maxReclaimable);
            return (
              // content-visibility: the list can hold up to
              // MAX_DUPLICATE_GROUPS rows; off-screen ones skip layout and
              // paint. The intrinsic size is the w-20 aspect-video thumbnail
              // plus the button's p-2 and border.
              <li
                key={key}
                className="[content-visibility:auto] [contain-intrinsic-size:auto_3.875rem]"
              >
                <button
                  type="button"
                  onClick={() => onSelect(key)}
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    selected
                      ? "border-primary bg-surface"
                      : "border-transparent hover:bg-fg/5",
                  )}
                >
                  <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-surface">
                    <MediaThumbnail
                      file={g.files[0]}
                      mediaBase={mediaBase}
                      version={0}
                      fallbackIconSize="size-5"
                      playOverlaySize="size-6"
                      playIconSize="size-3"
                    />
                    <span className="absolute right-1 bottom-1 rounded bg-bg/85 px-1 text-[11px] font-semibold text-bright-fg tabular-nums">
                      ×{g.files.length}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-sm text-bright-fg">
                      {groupName(g)}
                    </span>
                    <span className="flex items-baseline gap-2 text-xs text-muted tabular-nums">
                      <span>
                        {formatSize(g.size, "0 B")} × {g.files.length}
                      </span>
                      <span className="ml-auto font-semibold text-warn">
                        −{formatSize(reclaim, "0 B")}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className="block h-1 overflow-hidden rounded-full bg-overlay"
                    >
                      <span
                        className="block h-full rounded-full bg-warn"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
