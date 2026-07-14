// shadcn/ui-based ButtonGroup. Lays out adjacent buttons as a single unit with
// shared borders (rounded only on the outer edges, inner borders collapsed).
import * as React from "react";
import { cn } from "@/lib/utils";

function ButtonGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        "flex w-fit items-stretch",
        "[&>*]:rounded-none [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md",
        "[&>*:not(:first-child)]:-ml-px",
        "[&>*]:focus-visible:relative [&>*]:focus-visible:z-10",
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup };
