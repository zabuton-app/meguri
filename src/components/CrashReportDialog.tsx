// A crash report for the user to read before it goes anywhere (#544): they
// copy it, or copy it and open a new issue on GitHub to paste it into.
import { Copy, ExternalLink } from "lucide-react";
import type { CrashReport } from "@shared/ipc/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/ipc/client";
import { useCopyCrashReport } from "@/hooks/useCrashReports";
import { useI18n } from "@/i18n/I18nProvider";

export function CrashReportDialog({
  report,
  onOpenChange,
}: {
  /** The report shown; null closes the dialog. */
  report: CrashReport | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();

  const copy = useCopyCrashReport();

  return (
    <Dialog open={report !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="p-5 pb-3">
          <DialogTitle>{t("crash.reportTitle")}</DialogTitle>
          <DialogDescription>{t("crash.reportDesc")}</DialogDescription>
        </DialogHeader>
        <pre className="mx-5 max-h-[50vh] select-text overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-bg p-3 font-mono text-xs text-fg">
          {report?.text}
        </pre>
        <DialogFooter className="mt-4 border-t border-border p-4">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => report && void copy(report)}
          >
            <Copy className="size-4" />
            {t("crash.copy")}
          </Button>
          {report?.issueUrl && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const url = report.issueUrl;
                if (!url) return;
                // Copied first: the issue form is opened for the user to paste
                // the report into.
                void copy(report).then((ok) => {
                  if (ok) void api.openUrl(url);
                });
              }}
            >
              <ExternalLink className="size-4" />
              {t("crash.reportOnGitHub")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
