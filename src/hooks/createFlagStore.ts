// A boolean that lives outside React, for the cases where two trees need the
// same flag and props cannot reach across them (App mounts the status bar and
// the player bar beside the router, not inside it). Subscribers read it through
// useSyncExternalStore, so a change re-renders exactly them and nothing else.
import { useSyncExternalStore } from "react";

export interface FlagStore {
  /** Set the flag; listeners are only notified when the value actually changes. */
  set: (value: boolean) => void;
  /** Read the flag once, outside React (an event handler). Nothing re-renders
   *  when it later changes — subscribe with `use` for that. */
  get: () => boolean;
  /** Subscribe from a component. */
  use: () => boolean;
}

export interface HoldStore {
  /** Raise the flag until the returned release function is called. */
  hold: () => () => void;
  /** Read the flag once, outside React (an event handler). Nothing re-renders
   *  when it later changes — subscribe with `use` for that. */
  get: () => boolean;
  /** Subscribe from a component. */
  use: () => boolean;
}

/**
 * A flag that is up while at least one holder wants it up. Counted rather
 * than a plain boolean: each view that needs the flag takes a hold and
 * releases it on the way out, so two holders (StrictMode's double mount, a
 * view replaced by another in the same frame) cannot release each other's
 * hold, and a release that runs twice is harmless.
 */
export function createHoldStore(): HoldStore {
  const store = createFlagStore();
  let holds = 0;
  return {
    hold() {
      holds++;
      store.set(true);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        if (holds === 0) store.set(false);
      };
    },
    get: store.get,
    use: store.use,
  };
}

export function createFlagStore(initial = false): FlagStore {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const get = () => value;
  return {
    set(next) {
      if (value === next) return;
      value = next;
      listeners.forEach((l) => l());
    },
    get,
    use: () => useSyncExternalStore(subscribe, get),
  };
}
