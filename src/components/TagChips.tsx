import { LIST_HIDDEN_SOURCES, tagSearchToken } from "@shared/tags";
import type { TagInfo } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { tagColorClass } from "@/lib/tagColorClass";
import { tagHumanLabel } from "@/lib/tagLabel";
import { TagChipLabel } from "@/components/TagChipLabel";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  tags: TagInfo[] | undefined;
  /**
   * Receives the search-box token ("tag:beach" | "meta:4k" — a generated tag
   * carries the bare value; see tagSearchToken).
   * preventDefault/stopPropagation are applied here so callers can ignore them.
   */
  onTagClick?: (token: string) => void;
}

/**
 * Shared horizontally-scrollable tag chip row used by Grid / List / Table.
 *
 * Tags from LIST_HIDDEN_SOURCES are dropped: the metadata classifier alone emits
 * up to four tags per video, which would push the manual tags a user actually
 * curated out of this single scrolling line. They stay visible in the detail
 * view and on the tag management screen.
 */
export function TagChips({ tags, onTagClick }: Props) {
  const { t } = useI18n();
  const visible = tags?.filter(
    (tag) => !LIST_HIDDEN_SOURCES.includes(tag.source),
  );
  if (!visible || visible.length === 0) {
    return <span className="text-[10px] text-muted">{t("tag.none")}</span>;
  }
  return (
    <>
      {visible.map((tag) => (
        <button
          key={`${tag.id}-${tag.source}`}
          type="button"
          title={t("grid.searchByTag", {
            name: tagHumanLabel(t, tag.namespace, tag.name),
          })}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onTagClick?.(tagSearchToken(tag.namespace, tag.name));
          }}
          className={cn(
            "shrink-0 rounded px-1 text-[10px] leading-4 transition hover:ring-1 hover:ring-primary",
            tagColorClass(tag.source),
          )}
        >
          <TagChipLabel namespace={tag.namespace} name={tag.name} />
        </button>
      ))}
    </>
  );
}
