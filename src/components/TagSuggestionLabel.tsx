// What a tag completion reads as, in the search box's list and the command
// menu's `tag:` page alike.
import { TAG_SEARCH_PREFIX } from "@shared/tags";
import type { TagSummary } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { tagHumanLabel } from "@/lib/tagLabel";

export function TagSuggestionLabel({
  t,
  tag,
  held,
}: {
  t: TFunc;
  tag: TagSummary;
  /** False for a tag held only in other workspaces, which gets a note. */
  held: boolean;
}) {
  return (
    <>
      <span className="truncate">
        <span className="text-muted">{TAG_SEARCH_PREFIX}:</span>
        {tag.name}
      </span>
      {tag.namespace && (
        <span className="truncate text-xs text-muted">
          {tagHumanLabel(t, tag.namespace, tag.name)}
        </span>
      )}
      {!held && (
        <span className="truncate text-xs text-muted">
          {t("filter.tagElsewhere")}
        </span>
      )}
      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
        {tag.fileCount}
      </span>
    </>
  );
}
