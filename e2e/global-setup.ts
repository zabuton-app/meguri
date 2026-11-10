import { electronLaunchOptions } from "../scripts/electron-launch.cjs";

// The electron package has no install script: it downloads its binary on the
// first require("electron") after a fresh install, as on every CI job. Resolve it
// once here, through the same path the specs use, before the workers start, so
// parallel workers do not download it at the same time and launch a binary
// another one is still writing (spawn ETXTBSY).
export default function globalSetup(): void {
  electronLaunchOptions();
}
