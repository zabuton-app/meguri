// The slider mode's handle: drag it, or move it with the arrow keys.
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { clamp } from "./geometry";

const KEY_STEP = 0.02;

export function SplitHandle({
  split,
  onSplit,
  stageRef,
}: {
  split: number;
  onSplit: (split: number) => void;
  /** The stage the split is a fraction of. */
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const splitAt = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    onSplit(clamp((clientX - rect.left) / rect.width, 0, 1));
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t("compare.split")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split * 100)}
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        // The stage would take it as the start of a pan.
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        splitAt(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) splitAt(e.clientX);
      }}
      // Not the stage's double-click, which fits the view.
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const step =
          e.key === "ArrowLeft"
            ? -KEY_STEP
            : e.key === "ArrowRight"
              ? KEY_STEP
              : 0;
        if (!step) return;
        e.preventDefault();
        onSplit(clamp(split + step, 0, 1));
      }}
      className="absolute inset-y-0 z-10 flex w-6 -translate-x-1/2 cursor-ew-resize justify-center outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-ring"
      style={{ left: `${split * 100}%` }}
    >
      <span className="h-full w-0.5 bg-white/90 shadow-[0_0_4px_rgba(0,0,0,0.6)]" />
      <span className="absolute top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border-strong bg-surface text-fg shadow-lg">
        <ArrowLeftRight className="size-3.5" />
      </span>
    </div>
  );
}
