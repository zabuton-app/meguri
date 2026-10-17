// The floating panel of graph settings, laid out like Obsidian's: Display
// (what node size follows, label fade, node size, link thickness, and our
// own thumbnails switch with its file limit) and Forces (centre, repel, link
// force, link distance). Changes apply as they are made.
import { memo, useId } from "react";
import { RotateCcw, X } from "lucide-react";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import type { GraphDims } from "@shared/ipc/graph";
import {
  DISPLAY_RANGE,
  FORCE_RANGE,
  SIZE_BY,
  defaultGraphSettings,
  type DisplayScale,
  type SizeBy,
  type ForceSettings,
  type GraphSettings,
} from "./graphSettings";
import { thumbnailsOverLimit } from "./model/thumbnails";

function Slider({
  label,
  value,
  range: [min, max, step],
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  range: [number, number, number];
  disabled?: boolean;
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
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

const SIZE_BY_LABELS: Record<SizeBy, TranslationKey> = {
  links: "graph.settings.sizeBy.links",
  plays: "graph.settings.sizeBy.plays",
};
const DISPLAY_LABELS: Record<DisplayScale, TranslationKey> = {
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
  dims,
  settings,
  visibleFiles,
  onChange,
  onClose,
}: {
  /** In 3D links are hairlines: their thickness does not apply. Nor do
   *  thumbnails, which only the flat graph draws. */
  dims: GraphDims;
  settings: GraphSettings;
  /** File nodes visible now, for the over-the-limit hint. */
  visibleFiles: number;
  onChange: (next: GraphSettings) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const thumbnailsId = useId();
  const { display } = settings;
  const flat = dims === 2;
  const overLimit = thumbnailsOverLimit({ display, visibleFiles, dims });
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
        <div className="flex flex-col gap-1">
          <span className="text-xs text-secondary-fg">
            {t("graph.settings.sizeBy")}
          </span>
          <SegmentedControl
            value={settings.display.sizeBy}
            options={SIZE_BY.map((v) => ({
              value: v,
              label: t(SIZE_BY_LABELS[v]),
            }))}
            onChange={(sizeBy) =>
              onChange({
                ...settings,
                display: { ...settings.display, sizeBy },
              })
            }
            label={t("graph.settings.sizeBy")}
            slot="graph-size-by"
          />
        </div>
        {(Object.keys(DISPLAY_LABELS) as DisplayScale[])
          .filter((key) => dims === 2 || key !== "lineSize")
          .map((key) => (
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
          ))}
        <div className="flex flex-col gap-2" data-slot="graph-thumbnails">
          <div className="flex items-center justify-between gap-2 text-xs">
            <label htmlFor={thumbnailsId} className="text-secondary-fg">
              {t("graph.settings.thumbnails")}
            </label>
            <div className="flex items-center gap-2">
              {!flat && (
                <span className="text-muted">
                  {t("graph.settings.thumbnails2dOnly")}
                </span>
              )}
              <Switch
                id={thumbnailsId}
                checked={display.thumbnails}
                disabled={!flat}
                onCheckedChange={(thumbnails) =>
                  onChange({ ...settings, display: { ...display, thumbnails } })
                }
              />
            </div>
          </div>
          <Slider
            label={t("graph.settings.thumbnailLimit")}
            value={display.thumbnailLimit}
            range={DISPLAY_RANGE.thumbnailLimit}
            disabled={!flat || !display.thumbnails}
            onChange={(thumbnailLimit) =>
              onChange({ ...settings, display: { ...display, thumbnailLimit } })
            }
          />
          {/* Always there, so a count that crosses the limit is announced. */}
          <p role="status" className="text-xs text-muted empty:hidden">
            {overLimit
              ? t("graph.settings.thumbnailsOverLimit", {
                  count: visibleFiles.toLocaleString(),
                })
              : ""}
          </p>
        </div>
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
