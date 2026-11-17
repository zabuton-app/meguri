import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CrashReport } from "@shared/ipc/schema";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";

export const CRASH_REPORTS_QUERY_KEY = ["crash_reports"] as const;

/** Crash reports kept from earlier runs (#544), newest first. */
export function useCrashReports() {
  return useQuery({
    queryKey: CRASH_REPORTS_QUERY_KEY,
    queryFn: api.crashReportsList,
  });
}

/** Copies a report's text, saying how it went. Resolves to whether it did. */
export function useCopyCrashReport(): (
  report: CrashReport,
) => Promise<boolean> {
  const { t } = useI18n();
  return useCallback(
    (report) =>
      navigator.clipboard.writeText(report.text).then(
        () => {
          toast.success(t("crash.copied"));
          return true;
        },
        () => {
          toast.error(t("crash.copyFailed"));
          return false;
        },
      ),
    [t],
  );
}
