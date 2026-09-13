// A boolean that lives outside React, for the cases where two trees need the
// same flag and props cannot reach across them (App mounts the status bar and
// the player bar beside the router, not inside it). Subscribers read it through
// useSyncExternalStore, so a change re-renders exactly them and nothing else.
import { useSyncExternalStore } from "react";

export interface FlagStore {
  /** Set the flag; listeners are only notified when the value actually changes. */
  set: (value: boolean) => void;
  /** Subscribe from a component. */
  use: () => boolean;
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
    use: () => useSyncExternalStore(subscribe, get),
  };
}
