// The models found in the models folder, one row per usable weight variant.
// Selecting one is destructive — it clears the tags of the model being left —
// so the row hands that decision up rather than acting on it.
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import type { AiModelInfo } from "@/ipc/client";
import { formatSize } from "@/lib/format";

export function AiModelList({
  models,
  activeModelId,
  activeBackend,
  disabled,
  onSelect,
}: {
  models: readonly AiModelInfo[];
  activeModelId: string | null;
  activeBackend: string | null;
  disabled: boolean;
  /** null turns the feature off. */
  onSelect: (id: string | null) => void;
}) {
  const { t } = useI18n();
  if (models.length === 0) {
    return <p className="text-xs text-muted">{t("settings.aiNoModels")}</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {models.map((m) => {
        const active = m.id === activeModelId;
        return (
          <li
            key={m.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-fg">{m.name}</span>
              <span className="text-xs text-muted">
                {m.variant || t("ai.variantFp32")} · {m.dim}d ·{" "}
                {formatSize(m.bytes)}
                {active && activeBackend
                  ? ` · ${t("ai.backend", { backend: activeBackend })}`
                  : ""}
              </span>
            </div>
            {active ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="flex items-center gap-1 text-xs text-primary">
                  <Check className="size-4" />
                  {t("ai.active")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelect(null)}
                  disabled={disabled}
                >
                  {t("settings.aiDisable")}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => onSelect(m.id)}
                disabled={disabled}
              >
                {t("settings.aiUse")}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
