// Small pieces shared by the auto-tagging tabs.
import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Segment } from "@shared/autoTagAnalysis";
import type { TFunc } from "@/i18n/I18nProvider";

/** A proposed tag, in the tint the design gives proposals. */
export function Chip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded bg-secondary-accent/25 px-1.5 py-0.5 text-xs leading-4 text-bright-fg",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small outlined label: a rule kind, a term type, an origin. */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="w-max shrink-0 whitespace-nowrap rounded-md border border-border px-1.5 text-[10px] leading-4 text-muted">
      {children}
    </span>
  );
}

/** A file name with the matched parts highlighted. */
export function Highlighted({ segs }: { segs: readonly Segment[] }) {
  return (
    <>
      {segs.map((seg, i) =>
        seg.kind === "hit" ? (
          <mark key={i} className="rounded-sm bg-accent2/30 text-bright-fg">
            {seg.text}
          </mark>
        ) : seg.kind === "muted" ? (
          <span
            key={i}
            className="rounded-sm bg-muted/15 text-muted line-through"
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Count shown after the label. */
  count?: number;
}

/** A segmented control: one of a few values. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  tone = "surface",
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name. */
  label: string;
  /** The background it sits on, so the track contrasts with it. */
  tone?: "surface" | "bg";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "no-scrollbar flex w-max max-w-full gap-0.5 overflow-x-auto rounded-md p-0.5",
        tone === "surface" ? "bg-surface" : "bg-bg",
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-[26px] whitespace-nowrap rounded px-2.5 text-xs transition",
              active ? "bg-overlay text-bright-fg" : "text-muted hover:text-fg",
            )}
          >
            {option.label}
            {option.count != null && (
              <span className="ml-1 tabular-nums opacity-70">
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The scrolling body of a tab. Scrollbars in the app are the ScrollArea's, never
 * the platform's.
 *
 * Radix wraps the content in a table-display box that takes its content's
 * height; it is made a block that fills the viewport, so a pane's border or a
 * footer pinned to the bottom reaches the bottom even when the content is short.
 */
export function TabScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ScrollArea
      className="min-h-0 flex-1"
      viewportClassName="[&>div]:!block [&>div]:min-h-full"
    >
      <div className={cn("min-h-full", className)}>{children}</div>
    </ScrollArea>
  );
}

/** The toolbar band under the tabs. */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 py-2">
      {children}
    </div>
  );
}

/** A result line under the toolbar, with an optional way back. */
export function Notice({
  children,
  onUndo,
  undoLabel,
}: {
  children: ReactNode;
  onUndo?: () => void;
  undoLabel?: string;
}) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-border bg-success/10 px-3 py-2 text-xs text-success"
    >
      <span>{children}</span>
      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="text-muted underline underline-offset-2 hover:text-bright-fg"
        >
          {undoLabel}
        </button>
      )}
    </div>
  );
}

/** Outline / ghost / primary buttons at the design's small heights. */
export function SmallButton({
  variant = "outline",
  className,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: "outline" | "ghost" | "primary";
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "h-7 shrink-0 whitespace-nowrap rounded-md px-2.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40",
        variant === "outline" &&
          "border border-border-strong text-fg hover:bg-fg/10 hover:text-bright-fg",
        variant === "ghost" && "text-muted hover:bg-fg/10 hover:text-bright-fg",
        variant === "primary" &&
          "bg-primary font-medium text-primary-foreground hover:opacity-90",
        className,
      )}
    />
  );
}

export function MoreRows({ t, hidden }: { t: TFunc; hidden: number }) {
  if (hidden <= 0) return null;
  return (
    <p className="px-3 py-2 text-xs text-muted">
      {t("autoTag.moreRows", { count: hidden })}
    </p>
  );
}
