import fs from "node:fs";
import path from "node:path";

const source = process.env.MEGURI_SAMPLE_CONFIG ?? "/app/samples/config.json";
const target =
  process.env.MEGURI_CONFIG_PATH ?? "/home/node/.config/meguri/config.json";
const force = process.env.MEGURI_SEED_SAMPLE_CONFIG === "force";

if (!fs.existsSync(source)) {
  process.exit(0);
}

if (!force && fs.existsSync(target)) {
  process.exit(0);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);

// The app imports config.json into the library once and records it there
// (appConfig.ts). Forgetting that record makes the next launch import the
// sample again, over the settings it holds; the metadata stays.
if (force) {
  const library = path.join(path.dirname(target), "library.sqlite");
  if (fs.existsSync(library)) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(library);
    try {
      const table = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'",
        )
        .get();
      if (table) {
        db.prepare("DELETE FROM app_settings WHERE key = ?").run(
          "_config_json_imported_at",
        );
      }
    } finally {
      db.close();
    }
  }
}
