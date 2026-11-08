import type { DragEventHandler } from "react";
import { ArrowUpRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

export function ExternalFileDragHandle({
  onDragStart,
  className,
}: {
  onDragStart?: DragEventHandler<HTMLElement>;
  className: string;
}) {
  const { t } = useI18n();
  if (!onDragStart) return null;
  const label = t("drag.external");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      draggable
      onDragStart={onDragStart}
      className={cn(
        "pointer-events-none absolute z-10 flex size-6 cursor-grab items-center justify-center rounded bg-bg/70 text-fg opacity-0 backdrop-blur-[1px] transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 active:cursor-grabbing",
        className,
      )}
    >
      <ArrowUpRight aria-hidden className="pointer-events-none size-4" />
    </span>
  );
}
