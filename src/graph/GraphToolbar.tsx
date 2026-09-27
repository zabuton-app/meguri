// The row above the canvas: search, relationship-kind toggles, generated tags,
// orphans, the local graph and its depth, and re-layout.
import { memo, type ReactNode } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
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
}: {
  /** Omitted for a plain action button. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
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
  canLocal: boolean;
  onLocal: (on: boolean) => void;
  depth: number;
  onDepth: (depth: number) => void;
  layoutRunning: boolean;
  onRelayout: () => void;
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
  layoutRunning,
  onRelayout,
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
      {layoutRunning && (
        <span
          className="flex items-center gap-1.5 text-xs text-muted"
          role="status"
        >
          <LoaderCircle className="size-3.5 animate-spin" />
          {t("graph.layoutRunning")}
        </span>
      )}
      <Toggle disabled={layoutRunning} onClick={onRelayout}>
        <RefreshCw className="size-3.5" />
        {t("graph.relayout")}
      </Toggle>
    </div>
  );
});
