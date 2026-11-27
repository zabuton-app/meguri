// Renders a screen's header into the title bar (#578): Home's header lives
// there, beside the logo and the window buttons. The title bar owns the slot
// element (TitleBarSlot in titleBarSlotContext.ts).
import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TitleBarSlot } from "./titleBarSlotContext";

/** Render `children` in the title bar, or in place without one. */
export function TitleBarPortal({ children }: { children: ReactNode }) {
  const slot = useContext(TitleBarSlot);
  if (slot === undefined) return children;
  return slot ? createPortal(children, slot) : null;
}
