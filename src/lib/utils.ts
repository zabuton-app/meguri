import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The radius roles in src/styles.css, so a radius passed in className (say
// rounded-full on a Button) replaces the component's own rather than both
// being kept.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { radius: ["panel", "window", "card", "control", "item"] },
  },
});

/** Standard shadcn/ui className merge utility. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
