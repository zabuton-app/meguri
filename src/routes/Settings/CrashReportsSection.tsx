// Settings → About: the crash reports kept from earlier runs (#544).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Eye, FolderOpen, Trash2 } from "lucide-react";
import type { CrashReport } from "@shared/ipc/schema";
import { Button } from "@/components/ui/button";
import { CrashReportDialog } from "@/components/CrashReportDialog";
import {
  CRASH_REPORTS_QUERY_KEY,
  useCopyCrashReport,
  useCrashReports,
} from "@/hooks/useCrashReports";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { formatDateTime } from "@/lib/dates";

export function CrashReportsSection() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const reports = useCrashReports().data ?? [];
  const [shown, setShown] = useState<CrashReport | null>(null);

  const copy = useCopyCrashReport();
  const remove = (id: string) =>
    api
      .crashReportDelete(id)
      .catch(() => toast.error(t("crash.deleteFailed")))
      .finally(
        () =>
          void queryClient.invalidateQueries({
            queryKey: CRASH_REPORTS_QUERY_KEY,
          }),
      );

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-bright-fg">
          {t("crash.title")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={() =>
            void api
              .crashReportsOpenFolder()
              .catch(() => toast.error(t("crash.openFolderFailed")))
          }
        >
          <FolderOpen className="size-3.5" />
          {t("crash.openFolder")}
        </Button>
      </div>
      <p className="text-xs text-muted">{t("crash.desc")}</p>
      {reports.length === 0 ? (
        <p className="text-xs text-muted">{t("crash.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {reports.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-card border border-border bg-bg px-3 py-2"
            >
              <span className="text-xs text-fg">
                {formatDateTime(new Date(r.detectedAt), lang)}{" "}
                <span className="text-muted">
                  {t(
                    r.kind === "crashed"
                      ? "crash.kindCrashed"
                      : "crash.kindUncleanExit",
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => setShown(r)}
                >
                  <Eye className="size-3.5" />
                  {t("crash.view")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => void copy(r)}
                >
                  <Copy className="size-3.5" />
                  {t("crash.copy")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => void remove(r.id)}
                >
                  <Trash2 className="size-3.5" />
                  {t("crash.delete")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <CrashReportDialog
        report={shown}
        onOpenChange={(open) => {
          if (!open) setShown(null);
        }}
      />
    </div>
  );
}
