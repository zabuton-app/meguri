// Settings: CSS theme files. A picker over <userData>/themes/*.css (none by
// default) plus a button that opens the folder. The picked theme sits between
// the base16 theme above and custom.css below it.
import { useCallback } from "react";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/ipc/client";
import { useCssThemes } from "@/hooks/useCssThemes";
import { useI18n } from "@/i18n/I18nProvider";

/** Select value for "no theme": never a theme file, which must end in .css. */
const NONE = "none";

export function CssThemeSection() {
  const { t } = useI18n();
  const { state, select, pending } = useCssThemes();

  const openFolder = useCallback(() => {
    api
      .cssThemesOpenFolder()
      .catch(() => toast.error(t("settings.cssThemeOpenError")));
  }, [t]);

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-bright-fg">
            {t("settings.cssTheme")}
          </span>
          <span className="text-xs text-muted">
            {t("settings.cssThemeDesc")}
          </span>
        </div>
        <Select
          value={state?.selected ?? NONE}
          onValueChange={(v) => select(v === NONE ? null : v)}
          disabled={!state || pending}
        >
          <SelectTrigger
            className="min-w-36"
            aria-label={t("settings.cssTheme")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("settings.cssThemeNone")}</SelectItem>
            {state?.themes.map((theme) => (
              <SelectItem key={theme.file} value={theme.file}>
                {theme.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
