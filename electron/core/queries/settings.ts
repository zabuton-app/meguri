// The per-workspace key/value store declared in CORE_DDL. Values are opaque
// strings: a caller that wants a number or a hash formats it itself.
import type { DB } from "../db.js";

export function getSetting(db: DB, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
