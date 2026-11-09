// Settings: user stylesheet. An on/off switch plus a button that opens
// custom.css (creating it from a template first). The switch works whether or
// not the file exists yet: turned on before the file is made, it applies the
// file as soon as it appears.
import { useCallback } from "react";
import { FileCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/ipc/client";
import { useCustomCss } from "@/hooks/useCustomCss";
import { useI18n } from "@/i18n/I18nProvider";

export function CustomCssSection() {
  const { t } = useI18n();
  const { state, setEnabled, pending } = useCustomCss();

  const openFile = useCallback(() => {
    api
      .customCssOpen()
      .catch(() => toast.error(t("settings.customCssOpenError")));
  }, [t]);

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-bright-fg">
            {t("settings.customCss")}
          </span>
          <span className="text-xs text-muted">
            {t("settings.customCssDesc")}
          </span>
        </div>
        <Switch
          checked={state?.enabled ?? false}
          onCheckedChange={setEnabled}
          disabled={!state || pending}
          aria-label={t("settings.customCss")}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        {/* Selectable: the path is what the user looks for in a file manager. */}
        <span className="min-w-0 select-text break-all font-mono text-xs text-muted">
          {state?.path}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={openFile}
        >
          <FileCode className="size-4" />
          {t("settings.customCssOpen")}
        </Button>
      </div>
    </section>
  );
}
