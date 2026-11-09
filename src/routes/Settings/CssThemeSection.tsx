// Settings: where CSS theme files live. The files themselves are picked in the
// theme grid above; this section shows the folder and opens it.
import { useCallback } from "react";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/ipc/client";
import { useCssThemes } from "@/hooks/useCssThemes";
import { useI18n } from "@/i18n/I18nProvider";

export function CssThemeSection() {
  const { t } = useI18n();
  const { state } = useCssThemes();

  const openFolder = useCallback(() => {
    api
      .cssThemesOpenFolder()
      .catch(() => toast.error(t("settings.cssThemeOpenError")));
  }, [t]);

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3">
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-bright-fg">
          {t("settings.cssTheme")}
        </span>
        <span className="text-xs text-muted">{t("settings.cssThemeDesc")}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        {/* Selectable: the path is what the user looks for in a file manager. */}
        <span className="min-w-0 select-text break-all font-mono text-xs text-muted">
          {state?.dir}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={openFolder}
        >
          <FolderOpen className="size-4" />
          {t("settings.cssThemeOpenFolder")}
        </Button>
      </div>
    </section>
  );
}
