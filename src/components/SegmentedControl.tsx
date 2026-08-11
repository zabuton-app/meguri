// Single-select control for a handful of mutually exclusive values, laid out as
// adjacent segments.
//
// Radios rather than toggle buttons: with three independent `aria-pressed`
// buttons a screen reader can announce two as pressed, a state the control can
// never be in. Radio semantics also bring the arrow-key behavior users expect,
// which means roving tabindex — exactly one segment in the Tab order at a time.
import { useRef, type KeyboardEvent } from "react";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";

export interface Segment<T> {
  value: T;
  label: string;
}

interface Props<T> {
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  /** `data-slot` for tests and styling hooks. */
  slot: string;
  className?: string;
}

export function SegmentedControl<T>({
  value,
  options,
  onChange,
  label,
  slot,
  className,
}: Props<T>) {
  const group = useRef<HTMLDivElement>(null);
  // A stored query can hold a value none of the segments matches. Falling back
  // to the first one keeps a radio checked and keeps the group reachable: an
  // unmatched -1 would put tabIndex={-1} on every segment.
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const move = (next: number) => {
    onChange(options[next].value);
    group.current
      ?.querySelectorAll<HTMLElement>('[role="radio"]')
      [next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    let next: number | null = null;
    if (key === "ArrowRight" || key === "ArrowDown")
      next = (selected + 1) % options.length;
    else if (key === "ArrowLeft" || key === "ArrowUp")
      next = (selected - 1 + options.length) % options.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = options.length - 1;
    if (next == null) return;
    event.preventDefault();
    move(next);
  };

  return (
    <ButtonGroup
      ref={group}
      data-slot={slot}
      role="radiogroup"
      aria-label={label}
      className={cn("w-fit max-w-full", className)}
    >
      {options.map((option, i) => (
        <button
          key={option.label}
          type="button"
          role="radio"
          aria-checked={i === selected}
          tabIndex={i === selected ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={onKeyDown}
          className={cn(
            "h-8 truncate border px-3 text-sm transition-colors",
            i === selected
              ? "border-primary bg-primary font-medium text-primary-foreground"
              : "border-border text-muted hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </ButtonGroup>
  );
}
