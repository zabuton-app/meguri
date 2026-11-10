// Says, once a window, that config.json could not be used at startup (main's
// loadConfig, app_status.configProblem): the app runs on default settings.
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useI18n } from "@/i18n/I18nProvider";

export function useConfigProblemNotifier(): void {
  const { t } = useI18n();
  const problem = useAppStatus().data?.configProblem;
  const told = useRef(false);

  useEffect(() => {
    if (problem === undefined || told.current) return;
    told.current = true;
    if (problem === "moved-aside") {
      toast.warning(t("config.movedAside"), {
        description: t("config.movedAsideDesc"),
        duration: Infinity,
      });
    } else {
      toast.warning(t("config.unreadable"), {
        description: t("config.unreadableDesc"),
        duration: Infinity,
      });
    }
  }, [problem, t]);
}
