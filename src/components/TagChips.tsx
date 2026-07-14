import type { TagInfo } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { tagColorClass } from "@/lib/tagColorClass";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  tags: TagInfo[] | undefined;
  /** Click handler — preventDefault/stopPropagation are applied here so callers can ignore them. */
  onTagClick?: (name: string) => void;
}

/** Shared horizontally-scrollable tag chip row used by Grid / List / Table. */
export function TagChips({ tags, onTagClick }: Props) {
  const { t } = useI18n();
  if (!tags || tags.length === 0) {
    return <span className="text-[10px] text-muted">{t("tag.none")}</span>;
  }
  return (
    <>
      {tags.map((tag) => (
        <button
          key={`${tag.id}-${tag.source}`}
          type="button"
          title={t("grid.searchByTag", { name: tag.name })}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onTagClick?.(tag.name);
          }}
          className={cn(
            "shrink-0 rounded px-1 text-[10px] leading-4 transition hover:ring-1 hover:ring-primary",
            tagColorClass(tag.source),
          )}
        >
          {tag.name}
        </button>
      ))}
    </>
  );
}
