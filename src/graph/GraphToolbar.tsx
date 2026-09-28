// The row above the canvas: search, relationship-kind toggles, generated tags,
// orphans, the local graph and its depth, re-layout and the settings panel.
import { memo, type ReactNode } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { EDGE_SOURCE_INFO } from "./edgeSources";
import type { VisibilityOptions } from "./model/visibility";

function Toggle({
  pressed,
  disabled,
  onClick,
  children,
  label,
  hint,
}: {
  /** Omitted for a plain action button. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  /** For a button that shows only an icon. */
  label?: string;
  /** A tooltip. */
  hint?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label ?? hint}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40",
        pressed
          ? "border-border-strong bg-primary/20 text-fg"
          : "border-border text-muted hover:bg-fg/10 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

const DEPTHS = [1, 2, 3] as const;

interface Props {
  search: ReactNode;
  options: VisibilityOptions;
  onOptions: (patch: Partial<VisibilityOptions>) => void;
  local: boolean;
  /** A file has been opened, so there is something to centre a local graph on. */
  canLocal: boolean;
  onLocal: (on: boolean) => void;
  depth: number;
  onDepth: (depth: number) => void;
  onRelayout: () => void;
  settingsOpen: boolean;
  onSettings: (open: boolean) => void;
}

export const GraphToolbar = memo(function GraphToolbar({
  search,
  options,
  onOptions,
  local,
  canLocal,
  onLocal,
  depth,
  onDepth,
  onRelayout,
  settingsOpen,
  onSettings,
}: Props) {
  const { t } = useI18n();
  return (
    <div
      role="toolbar"
      aria-label={t("view.graph")}
      className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
    >
      {search}
      <div className="flex-1" />
      {EDGE_SOURCE_INFO.map((s) => (
        <Toggle
          key={s.id}
          pressed={options.edgeSources[s.id] !== false}
          onClick={() =>
            onOptions({
              edgeSources: {
                ...options.edgeSources,
                [s.id]: options.edgeSources[s.id] === false,
              },
            })
          }
        >
          {t(s.label)}
        </Toggle>
      ))}
      <Toggle
        pressed={options.showAutoTags}
        onClick={() => onOptions({ showAutoTags: !options.showAutoTags })}
      >
        {t("graph.toggle.autoTags")}
      </Toggle>
      <Toggle
        pressed={options.showOrphans}
        onClick={() => onOptions({ showOrphans: !options.showOrphans })}
      >
        {t("graph.toggle.orphans")}
      </Toggle>
      <div className="mx-1 h-5 w-px bg-border" />
      <Toggle
        pressed={local && canLocal}
        disabled={!canLocal}
        onClick={() => onLocal(!local)}
        hint={t("graph.localHint")}
      >
        {t("graph.toggle.local")}
      </Toggle>
      <div
        className={cn(!(local && canLocal) && "pointer-events-none opacity-40")}
      >
        <SegmentedControl
          value={depth}
          options={DEPTHS.map((d) => ({ value: d, label: String(d) }))}
          onChange={onDepth}
          label={t("graph.depth")}
          slot="graph-depth"
        />
      </div>
      <div className="mx-1 h-5 w-px bg-border" />
      <Toggle onClick={onRelayout}>
        <RefreshCw className="size-3.5" />
        {t("graph.relayout")}
      </Toggle>
      <Toggle
        pressed={settingsOpen}
        onClick={() => onSettings(!settingsOpen)}
        label={t("graph.settings.title")}
      >
        <Settings2 className="size-3.5" />
      </Toggle>
    </div>
  );
});
