// The row above the canvas: search, relationship-kind toggles, generated tags,
// orphans, 2D / 3D, re-layout and the settings panel.
import { memo, type ReactNode } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { EDGE_SOURCE_INFO } from "./edgeSources";
import type { VisibilityOptions } from "./model/visibility";
import type { GraphDims } from "@shared/ipc/graph";

function Toggle({
  pressed,
  disabled,
  onClick,
  children,
  label,
}: {
  /** Omitted for a plain action button. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  /** For a button that shows only an icon. */
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
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

interface Props {
  search: ReactNode;
  options: VisibilityOptions;
  onOptions: (patch: Partial<VisibilityOptions>) => void;
  onRelayout: () => void;
  settingsOpen: boolean;
  onSettings: (open: boolean) => void;
  dims: GraphDims;
  onDims: (dims: GraphDims) => void;
}

const DIMS = [
  { value: 2, label: "2D" },
  { value: 3, label: "3D" },
] as const satisfies readonly { value: GraphDims; label: string }[];

export const GraphToolbar = memo(function GraphToolbar({
  search,
  options,
  onOptions,
  onRelayout,
  settingsOpen,
  onSettings,
  dims,
  onDims,
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
      <SegmentedControl<GraphDims>
        value={dims}
        options={DIMS}
        onChange={onDims}
        label={t("graph.dims")}
        slot="graph-dims"
      />
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
