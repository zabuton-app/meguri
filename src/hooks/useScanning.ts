// Whether a scan the user just asked for is in flight, from the click until the
// main process reports `scan:done`. Lives outside React because two trees need
// it: Home (header button, command menu) starts scans, while the StatusBar is
// mounted in App next to the audio player bar — outside the router — so props
// cannot reach it. Progress *during* a scan comes from IPC events; this only
// covers the window before the first progress event arrives.
import { createFlagStore } from "./createFlagStore";

const store = createFlagStore();

export const setScanning: (value: boolean) => void = store.set;
export const useScanning: () => boolean = store.use;
