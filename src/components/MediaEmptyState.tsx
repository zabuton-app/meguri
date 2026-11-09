// Shared "nothing to show" panel for the grid / list views.
// Extracted so the copy stays identical across both, and so lists that are
// not scan-backed (Watch Later) can explain themselves instead of telling the
// user to run a scan that would never populate them.
import { Clock, FolderSearch, ImageIcon } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export type FilterFeedback = { combination: boolean; paused: string[] };

export function MediaEmptyState({
  watchLater = false,
  inFolder = false,
  filtered = false,
  feedback,
}: {
  /** Whether the built-in Watch Later collection is the active view. */
  watchLater?: boolean;
  /**
   * A search scoped to the folder being viewed came back empty. Scanning would
   * not help; widening the search (or searching further up) would.
   */
  inFolder?: boolean;
  /** Active search/bin criteria returned no files; scanning is not the remedy. */
  filtered?: boolean;
  feedback?: FilterFeedback;
}) {
  const { t } = useI18n();
  if (filtered) {
    return (
      <div
        role="status"
        data-slot="filtered-empty"
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <p className="text-lg font-semibold text-bright-fg">
          {t(
            feedback?.combination
              ? "home.noCombinationMatches"
              : "home.noFilterMatches",
          )}
        </p>
        <p className="max-w-md text-sm text-fg">
          {feedback?.paused.length
            ? t("home.pausedFilterHint", {
                filters: feedback.paused.join(", "),
              })
            : t("home.noFilterMatchesHint")}
        </p>
      </div>
    );
  }
  const Icon = watchLater ? Clock : inFolder ? FolderSearch : ImageIcon;
  const [title, hint] = watchLater
    ? [t("watchLater.empty"), t("watchLater.emptyHint")]
    : inFolder
      ? [t("folder.emptySearch"), t("folder.emptySearchHint")]
      : [t("grid.empty"), t("grid.emptyHint")];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
      <Icon className="size-10 opacity-50" />
      <p>{title}</p>
      <p className="max-w-md text-center text-xs">{hint}</p>
    </div>
  );
}
