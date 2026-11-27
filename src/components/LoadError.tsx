// What a view shows in place of its list when the first load failed, so a
// failure does not read as "nothing here".
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

export function LoadError({
  message,
  onRetry,
  retrying,
  className,
}: {
  message: string;
  onRetry: () => void;
  /** The retry is in flight: the button waits for it. */
  retrying: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center text-muted",
        className,
      )}
    >
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
