// Tab bar for the settings screen.
//
// Tab semantics rather than the radiogroup of SegmentedControl: these switch
// which panel is shown, they do not pick a value. The roving tabindex is the
// same idea though — exactly one tab in the Tab order, arrows move between them.
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface SettingsTab<T extends string> {
  id: T;
  label: string;
}

export function SettingsTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly SettingsTab<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name for the tab list. */
  label: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  // An unmatched id would put tabIndex={-1} on every tab and strand keyboard
  // users outside the list, so fall back to the first one.
  const selected = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === value),
  );

  const move = (next: number) => {
    onChange(tabs[next].id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    let next: number | null = null;
    if (key === "ArrowRight" || key === "ArrowDown")
      next = (selected + 1) % tabs.length;
    else if (key === "ArrowLeft" || key === "ArrowUp")
      next = (selected - 1 + tabs.length) % tabs.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = tabs.length - 1;
    if (next == null) return;
    event.preventDefault();
    move(next);
  };

  return (
    // The rule under the tabs lives on this wrapper, not on the scrolling strip.
    // Asking for overflow-x alone would make overflow-y compute to auto as well
    // (visible cannot pair with a scrolling axis), and anything bleeding past the
    // strip's box — the 1px the active underline is pulled down by — would then
    // raise a stray vertical scrollbar. Keeping the pull on the strip itself
    // leaves every child inside the box, so only the horizontal axis can scroll.
    <div className="shrink-0 border-b border-border bg-bg">
      <div
        ref={list}
        role="tablist"
        aria-label={label}
        data-slot="settings-tabs"
        className="-mb-px flex gap-1 overflow-x-auto overflow-y-hidden px-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            id={`settings-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={i === selected}
            // Only the selected tab's panel is in the DOM, so only that tab may
            // point at one: a reference to a missing element is worse for a
            // screen reader than no reference at all.
            aria-controls={
              i === selected ? `settings-panel-${tab.id}` : undefined
            }
            tabIndex={i === selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={onKeyDown}
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
              i === selected
                ? "border-primary font-medium text-bright-fg"
                : "border-transparent text-muted hover:text-fg",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
