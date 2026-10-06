// Small pieces shared by the auto-tagging tabs.
import { useState, type ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Segment } from "@shared/autoTagAnalysis";
import type { TFunc } from "@/i18n/I18nProvider";
import { MAX_TAG_NAME } from "@shared/tags";
import { MONO } from "./helpers";
import type { Paging } from "./paging";

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

/** A small outlined label: a rule kind. */
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
 * the platform's. The content fills the height when it is short, so a footer
 * pinned to the bottom is at the bottom.
 */
export function TabScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1" fillViewport>
      <div className={cn("flex-1", className)}>{children}</div>
    </ScrollArea>
  );
}

/**
 * A list beside the thing selected in it, each scrolling on its own: a long
 * pane on one side must not carry the other side away with it.
 *
 * Side by side when there is room; stacked when there is not, the list taking
 * a fixed share of the height above the pane.
 */
export function SplitPane({
  aside,
  children,
}: {
  aside: ReactNode;
  children: ReactNode;
}) {
  return (
    // The container is a wrapper of its own: a container query cannot restyle
    // the element it measures.
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col @[760px]:flex-row">
        <ScrollArea
          className="h-2/5 shrink-0 border-b border-border @[760px]:h-auto @[760px]:w-[360px] @[760px]:border-b-0 @[760px]:border-r"
          // Radix lays the content out as a table, which is as wide as its
          // longest line: a block instead, so a line too long is cut short
          // rather than scrolled to.
          viewportClassName="[&>div]:!block"
        >
          {aside}
        </ScrollArea>
        <ScrollArea className="min-h-0 min-w-0 flex-1" fillViewport>
          {/* The pane fills the height when it is short; its own root need
              not know to. */}
          <div className="flex flex-1 flex-col">{children}</div>
        </ScrollArea>
      </div>
    </div>
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

/** A result line under the toolbar. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-border bg-success/10 px-3 py-2 text-xs text-success"
    >
      <span>{children}</span>
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

/**
 * Previous / next for a list drawn a page at a time (see usePaging): a band
 * under the tab's scrolling area, not at the end of the list inside it, so it
 * is in reach wherever the list is scrolled to. Nothing for a list that fits
 * on one page.
 */
export function Pager({ t, paging }: { t: TFunc; paging: Paging }) {
  const { page, pages, start, end, total, setPage } = paging;
  if (pages <= 1) return null;
  const go = (next: number, from: HTMLElement) => {
    setPage(next);
    // The new page starts at its top, not wherever the last one was left. The
    // list is the scrolling area this band sits under (TabScroll).
    from
      .closest("nav")
      ?.parentElement?.querySelector(
        ':scope > [data-slot="scroll-area"] > [data-slot="scroll-area-viewport"]',
      )
      ?.scrollTo?.({ top: 0 });
  };
  return (
    <nav
      aria-label={t("autoTag.page.label")}
      className="flex shrink-0 items-center justify-center gap-3 border-t border-border bg-surface px-3 py-2 text-xs text-muted"
    >
      <SmallButton
        disabled={page === 0}
        onClick={(e) => go(page - 1, e.currentTarget)}
      >
        {t("autoTag.page.prev")}
      </SmallButton>
      <span className="tabular-nums" aria-live="polite">
        {t("autoTag.page.range", { from: start + 1, to: end, total })}
      </span>
      <SmallButton
        disabled={page >= pages - 1}
        onClick={(e) => go(page + 1, e.currentTarget)}
      >
        {t("autoTag.page.next")}
      </SmallButton>
    </nav>
  );
}

/**
 * A list of values as chips, each with its ×, and a field to add more —
 * several at once, "a, b" — up to `max`. `onAdd` gets the raw pieces: what
 * they become (cleaned, deduplicated, capped) is the caller's.
 */
export function ChipListField({
  label,
  items,
  max,
  kind,
  addLabel,
  removeLabel,
  empty,
  heading,
  onAdd,
  onRemove,
}: {
  label: string;
  items: readonly string[];
  max: number;
  /** Tags are chips; terms are plain outlined, in the name font. */
  kind: "tag" | "term";
  addLabel: string;
  removeLabel: (item: string) => string;
  /** Said, as a warning, while there is nothing in the list. */
  empty: string;
  /** Sits at the right of the label. */
  heading?: ReactNode;
  onAdd: (raw: string[]) => void;
  onRemove: (item: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    onAdd(draft.split(/[,、]/));
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">{label}</span>
        {heading}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((item) => {
          const remove = (
            <button
              type="button"
              aria-label={removeLabel(item)}
              onClick={() => onRemove(item)}
              className="px-1 text-[13px] text-muted hover:text-bright-fg"
            >
              ×
            </button>
          );
          return kind === "tag" ? (
            <Chip key={item} className="flex items-center gap-1 pr-1">
              {item}
              {remove}
            </Chip>
          ) : (
            <span
              key={item}
              className={cn(
                MONO,
                "flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border pl-2 pr-1 text-xs text-fg",
              )}
            >
              {item}
              {remove}
            </span>
          );
        })}
        {items.length < max && (
          <input
            className="h-6 w-44 rounded-md border border-dashed border-border-strong bg-transparent px-2 text-xs text-bright-fg outline-none placeholder:text-muted focus-visible:border-ring"
            value={draft}
            maxLength={MAX_TAG_NAME * 4}
            placeholder={addLabel}
            aria-label={addLabel}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Not while an IME is composing: that Enter only confirms the text.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) add();
            }}
          />
        )}
      </div>
      {items.length === 0 && <span className="text-xs text-warn">{empty}</span>}
    </div>
  );
}
