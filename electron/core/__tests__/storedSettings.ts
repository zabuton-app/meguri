// Settings as stored in the library (app_settings, see appConfig.ts), written
// the way a hand edit or another version would: every row replaced by
// `values`, one per top-level field, and config.json recorded as imported so
// it is not read over them.
import path from "node:path";
import { IMPORTED_KEY } from "../appConfig.js";
import { openSettingsDb } from "../db.js";

export function writeStoredSettings(
  userData: string,
  values: Record<string, unknown>,
): void {
  const db = openSettingsDb(path.join(userData, "library.sqlite"));
  try {
    const put = db.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?)",
    );
    db.transaction(() => {
      db.prepare("DELETE FROM app_settings").run();
      put.run(IMPORTED_KEY, JSON.stringify(0));
      for (const [key, value] of Object.entries(values)) {
        put.run(key, JSON.stringify(value));
      }
    })();
  } finally {
    db.close();
  }
}
