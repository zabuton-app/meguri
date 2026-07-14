import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Standard shadcn/ui className merge utility. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
