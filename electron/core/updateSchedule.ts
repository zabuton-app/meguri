// Background update checks: one shortly after launch, then on a timer for as
// long as the app runs (#284). The app lives in the tray for weeks, so a
// check at launch alone would miss every release until the next restart.
import type { UpdateInfo } from "../../shared/ipc/schema.js";

/** After launch: late enough not to compete with the first scan and render. */
export const FIRST_CHECK_DELAY_MS = 8_000;
/** How often the timer fires. The network is reached only when the last
 *  successful check is older than CHECK_THROTTLE_MS in updater.ts: ticking
 *  more often than that keeps a check from slipping a whole period behind it. */
export const CHECK_TICK_MS = 60 * 60 * 1000;

export interface UpdateScheduleDeps {
  /** checkForUpdates() without force: throttled, null when it did not run. */
  check: () => Promise<UpdateInfo | null>;
  /** Read on every tick, so turning automatic checks off stops them. */
  isEnabled: () => boolean;
  announce: (info: UpdateInfo) => void;
  onError: (e: unknown) => void;
}

export interface UpdateChecks {
  stop: () => void;
  /** The renderer that showed the notice is gone (reloaded, or a new window):
   *  announce the release again on the next check. */
  forget: () => void;
}

export function scheduleUpdateChecks(deps: UpdateScheduleDeps): UpdateChecks {
  // A release found again on a later tick is not announced again: the notice
  // stays up until the user acts on it.
  let announced: string | null = null;
  const tick = () => {
    if (!deps.isEnabled()) return;
    deps
      .check()
      .then((info) => {
        if (!info?.available || info.latest === announced) return;
        announced = info.latest;
        deps.announce(info);
      })
      .catch(deps.onError);
  };
  let interval: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    tick();
    interval = setInterval(tick, CHECK_TICK_MS);
    interval.unref();
  }, FIRST_CHECK_DELAY_MS);
  first.unref();
  return {
    stop: () => {
      clearTimeout(first);
      clearInterval(interval);
    },
    forget: () => {
      announced = null;
    },
  };
}
