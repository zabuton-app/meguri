// Whether a scan the user just asked for is in flight, from the click until the
// main process reports `scan:done`. Lives outside React because two trees need
// it: Home (header button, command menu) starts scans, while the StatusBar is
// mounted in App next to the audio player bar — outside the router — so props
// cannot reach it. Progress *during* a scan comes from IPC events; this only
// covers the window before the first progress event arrives.
import { useSyncExternalStore } from "react";

let scanning = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setScanning(value: boolean): void {
  if (scanning === value) return;
  scanning = value;
  listeners.forEach((l) => l());
}

export function useScanning(): boolean {
  return useSyncExternalStore(subscribe, () => scanning);
}
