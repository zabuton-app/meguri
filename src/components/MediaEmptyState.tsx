// Shared "nothing to show" panel for the grid / list / table views.
// Extracted so the copy stays identical across all three, and so lists that are
// not scan-backed (Watch Later) can explain themselves instead of telling the
// user to run a scan that would never populate them.
import { Clock, ImageIcon } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export function MediaEmptyState({
  watchLater = false,
}: {
  /** Whether the built-in Watch Later collection is the active view. */
  watchLater?: boolean;
}) {
  const { t } = useI18n();
  const Icon = watchLater ? Clock : ImageIcon;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
      <Icon className="size-10 opacity-50" />
      <p>{watchLater ? t("watchLater.empty") : t("grid.empty")}</p>
      <p className="max-w-md text-center text-xs">
        {watchLater ? t("watchLater.emptyHint") : t("grid.emptyHint")}
      </p>
    </div>
  );
}
