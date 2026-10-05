// shadcn/ui ScrollArea (Radix implementation). Used for scroll regions across the app.
import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/utils";

function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportRef,
  fillViewport = false,
  type,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string;
  /**
   * Make the content at least as tall as the viewport, so a child given
   * `flex-1` fills it while the content is short (a pane border that runs to
   * the bottom, a footer pinned there).
   *
   * Radix wraps the content in a `display: table` box that is only as tall as
   * the content; this turns that box into a flex column of the viewport's
   * height. A percentage `min-height` on the child would not do — the box has
   * no height of its own to take a percentage of. Knowledge of that box stays
   * in this file.
   */
  fillViewport?: boolean;
  /** Ref to the Viewport (the actual scroll element). Used by virtualization's getScrollElement, etc. */
  viewportRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      type={type ?? "always"}
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring",
          fillViewport && "[&>div]:!flex [&>div]:min-h-full [&>div]:flex-col",
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-px transition-colors",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-overlay transition-colors hover:bg-muted"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
