// Tests for QueryWorkerClient's degradation paths. A worker pointed at a
// missing bundle spawns but dies on every request (async MODULE_NOT_FOUND) —
// after enough consecutive crashes the client must pin itself to the
// main-thread fallback instead of respawning forever.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../db.js";
import { upsertScanRoot } from "../queries.js";
import { QueryWorkerClient } from "../queryWorkerClient.js";
import { insertFile } from "./helpers.js";
import type { WorkspaceStats } from "../types.js";

let dir: string;
let db: DB;
let dbPath: string;
let client: QueryWorkerClient;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "meguri-queryclient-"));
  dbPath = path.join(dir, "db.sqlite");
  db = openDb(dbPath);
  const rootId = upsertScanRoot(db, "/fake/root", "deadbeef");
  for (let i = 0; i < 4; i++) insertFile(db, rootId, { relPath: `v${i}.mp4` });
  client = new QueryWorkerClient(path.join(dir, "no-such-worker.js"));
});

afterEach(async () => {
  await client.dispose();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const statsReq = () => ({
  kind: "stats" as const,
  targets: [{ id: "ws1", dbPath }],
});

describe("QueryWorkerClient", () => {
  it("falls back to the main thread after repeated worker crashes", async () => {
    // The worker bundle doesn't exist: each spawn dies with an async module
    // error, rejecting the in-flight request.
    for (let i = 0; i < 3; i++) {
      await expect(client.run(statsReq())).rejects.toThrow();
    }
    // Crash limit reached: the client now executes on the main thread.
    const stats = await client.run<WorkspaceStats>(statsReq());
    expect(stats.fileCount).toBe(4);
  });

  it("rejects (not throws) when the fallback executor fails synchronously", async () => {
    for (let i = 0; i < 3; i++) {
      await client.run(statsReq()).catch(() => {});
    }
    // Now on the fallback path. An invalid request makes the executor throw
    // synchronously; the client must still return a rejected promise.
    const bad = { kind: "search" as const, targets: [{ id: "ws1", dbPath }] };
    const p = client.run(bad as never); // missing `query` → sync TypeError
    expect(p).toBeInstanceOf(Promise);
    await expect(p).rejects.toThrow();
  });

  it("closeWorkspace releases the fallback handle so the DB dir can be deleted", async () => {
    for (let i = 0; i < 3; i++) {
      await client.run(statsReq()).catch(() => {});
    }
    await client.run(statsReq()); // fallback opens a read-only handle
    await client.closeWorkspace("ws1");
    // Reopens lazily on the next query (the file still exists).
    const stats = await client.run<WorkspaceStats>(statsReq());
    expect(stats.fileCount).toBe(4);
  });
});
