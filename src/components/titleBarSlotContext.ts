// The part of the title bar a screen fills with its own header (#578), shared
// between the title bar, which owns the element, and <TitleBarPortal>
// (titleBarSlot.tsx), which renders into it.
import { createContext } from "react";

/**
 * The slot element, null until the title bar has mounted it. Undefined
 * outside a TitleBarSlot provider (a screen rendered on its own, as in its
 * tests), where the content stays in place.
 */
export const TitleBarSlot = createContext<HTMLElement | null | undefined>(
  undefined,
);
