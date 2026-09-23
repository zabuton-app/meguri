// The AI index job's progress, as a labelled bar. Beside ScanProgress rather
// than inside the settings screen: a background job belongs to the app, not to
// the one screen that happens to show it today.
import { useI18n } from "@/i18n/I18nProvider";
import type { AiJobState } from "@/ipc/client";

export function AiJobProgress({ job }: { job: AiJobState }) {
  const { t } = useI18n();
  const label = job.label === "tag" ? t("ai.jobTag") : t("ai.jobEmbed");
  const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono">
          {job.total > 0 ? `${job.done} / ${job.total}` : ""}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-overlay"
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* An indeterminate phase (no total yet) fills the bar rather than
            showing an empty one that looks stalled. */}
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: pct === null ? "100%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}
