import { handle } from "../core/ipcHandler.js";
import {
  checkForUpdates,
  getUpdateSettings,
  ignoreVersion,
  setAutoCheck,
} from "../core/updater.js";

export function registerUpdateHandlers(): void {
  handle("update_check", ({ force }) => checkForUpdates({ force }));
  handle("update_get_settings", () => getUpdateSettings());
  handle("update_set_auto_check", ({ enabled }) => {
    setAutoCheck(enabled);
  });
  handle("update_ignore", ({ version }) => {
    ignoreVersion(version);
  });
}
