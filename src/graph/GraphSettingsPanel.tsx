// The floating panel of graph settings, laid out like Obsidian's: Display
// (label fade, node size, link thickness) and Forces (centre, repel, link
// force, link distance). Changes apply as the sliders move.
import { memo, useId } from "react";
import { RotateCcw, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import {
  DISPLAY_RANGE,
  FORCE_RANGE,
  defaultGraphSettings,
  type DisplaySettings,
  type ForceSettings,
  type GraphSettings,
} from "./graphSettings";

function Slider({
  label,
  value,
  range: [min, max, step],
  onChange,
}: {
  label: string;
  value: number;
  range: [number, number, number];
  onChange: (value: number) => void;
}) {
  const id = useId();
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <label htmlFor={id} className="text-secondary-fg">
          {label}
        </label>
        <span className="font-mono text-muted">{value.toFixed(digits)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

const DISPLAY_LABELS: Record<keyof DisplaySettings, TranslationKey> = {
  textFade: "graph.settings.textFade",
  nodeSize: "graph.settings.nodeSize",
  lineSize: "graph.settings.lineSize",
};
const FORCE_LABELS: Record<keyof ForceSettings, TranslationKey> = {
  center: "graph.settings.center",
  repel: "graph.settings.repel",
  link: "graph.settings.link",
  distance: "graph.settings.distance",
};

export const GraphSettingsPanel = memo(function GraphSettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: GraphSettings;
  onChange: (next: GraphSettings) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const iconButton =
    "flex size-7 items-center justify-center rounded-md text-muted transition hover:bg-fg/10 hover:text-fg";
  return (
    <section
      aria-label={t("graph.settings.title")}
      className="flex w-64 flex-col gap-4 rounded-lg border border-border bg-surface/95 p-3 shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-fg">
          {t("graph.settings.title")}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("graph.settings.reset")}
            title={t("graph.settings.reset")}
            onClick={() => onChange(defaultGraphSettings())}
            className={iconButton}
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("graph.settings.close")}
            title={t("graph.settings.close")}
            onClick={onClose}
            className={iconButton}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
          {t("graph.settings.display")}
        </h3>
        {(Object.keys(DISPLAY_LABELS) as (keyof DisplaySettings)[]).map(
          (key) => (
            <Slider
              key={key}
              label={t(DISPLAY_LABELS[key])}
              value={settings.display[key]}
              range={DISPLAY_RANGE[key]}
              onChange={(v) =>
                onChange({
                  ...settings,
                  display: { ...settings.display, [key]: v },
                })
              }
            />
          ),
        )}
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
          {t("graph.settings.forces")}
        </h3>
        {(Object.keys(FORCE_LABELS) as (keyof ForceSettings)[]).map((key) => (
          <Slider
            key={key}
            label={t(FORCE_LABELS[key])}
            value={settings.forces[key]}
            range={FORCE_RANGE[key]}
            onChange={(v) =>
              onChange({
                ...settings,
                forces: { ...settings.forces, [key]: v },
              })
            }
          />
        ))}
      </div>
    </section>
  );
});
