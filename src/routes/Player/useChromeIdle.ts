import { useCallback, useEffect, useRef, useState } from "react";

/** Idle time before the control bar fades away. */
const CHROME_IDLE_MS = 2500;

/**
 * Control bar visibility: visible on activity, out of the way once the user
 * settles. `wake` shows it and re-arms the hide timer.
 */
export function useChromeIdle(): {
  chromeVisible: boolean;
  wake: () => void;
} {
  const [chromeVisible, setChromeVisible] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useCallback(() => {
    setChromeVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(
      () => setChromeVisible(false),
      CHROME_IDLE_MS,
    );
  }, []);
  // The bar starts visible, so mounting only has to arm the hide timer — calling
  // wake() here would set state that is already set.
  useEffect(() => {
    idleTimer.current = setTimeout(
      () => setChromeVisible(false),
      CHROME_IDLE_MS,
    );
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);
  return { chromeVisible, wake };
}

/**
 * Wake the control bar whenever `value` changes — but not on the first run,
 * which is the value settling rather than the user doing anything. Used for
 * changes that draw no chrome of their own here (the volume level, an audio
 * play/pause in the bottom bar) and would otherwise change nothing on screen.
 * While `enabled` is false the change is ignored and the first-run guard is
 * left as it is.
 */
export function useWakeOnChange(
  wake: () => void,
  value: unknown,
  enabled = true,
): void {
  const ready = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    if (!ready.current) {
      ready.current = true;
      return;
    }
    wake();
  }, [enabled, value, wake]);
}
