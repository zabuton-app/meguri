// Measures a block rendered inside a virtualized scroll viewport before the
// rows (the home landing shelves), so the virtualizer can offset the rows by
// it (`scrollMargin`) and each row can be positioned relative to the rows'
// own container (`start - height`; the virtualizer's total size already has
// the margin taken off). Zero while nothing is rendered there.
import { useCallback, useEffect, useState } from "react";

export function useLeadingBlock() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  const leadingRef = useCallback(
    (node: HTMLDivElement | null) => setEl(node),
    [],
  );

  useEffect(() => {
    if (!el) {
      // The block unmounted (collapsed away / hidden): rows start at the top.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHeight(0);
      return;
    }
    // Rounded: a sub-pixel wobble would otherwise re-run the virtualizer's
    // measurements for nothing.
    const measure = () =>
      setHeight(Math.round(el.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return { leadingRef, leadingHeight: height } as const;
}
