// Says, once a window, that the previous run ended abnormally (#544). A
// toast rather than a modal: the app may start in the tray, and it is
// dismissed without a choice to make.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { CrashReport } from "@shared/ipc/schema";
import { CrashReportDialog } from "@/components/CrashReportDialog";
import { useCrashReports } from "@/hooks/useCrashReports";
import { useI18n } from "@/i18n/I18nProvider";

export function CrashReportNotice() {
  const { t } = useI18n();
  const report = useCrashReports().data?.find((r) => r.isNew);
  const told = useRef(false);
  const [shown, setShown] = useState<CrashReport | null>(null);

  useEffect(() => {
    if (!report || told.current) return;
    told.current = true;
    toast.warning(
      t(report.kind === "crashed" ? "crash.crashed" : "crash.uncleanExit"),
      {
        id: "crash-report",
        description: t("crash.noticeDesc"),
        duration: Infinity,
        action: {
          label: t("crash.viewReport"),
          onClick: () => setShown(report),
        },
        cancel: { label: t("crash.dismiss"), onClick: () => {} },
      },
    );
  }, [report, t]);

  return (
    <CrashReportDialog
      report={shown}
      onOpenChange={(open) => {
        if (!open) setShown(null);
      }}
    />
  );
}
