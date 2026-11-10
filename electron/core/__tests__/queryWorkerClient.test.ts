// Tests for QueryWorkerClient's degradation paths. A worker pointed at a
// missing bundle spawns but dies on every request (async MODULE_NOT_FOUND) —
// the queries in flight are answered by the main-thread fallback, and after
// enough consecutive crashes the client pins itself to the fallback instead of
// respawning forever.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
let libraryPath: string;
let client: QueryWorkerClient;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "meguri-queryclient-"));
  dbPath = path.join(dir, "db.sqlite");
  libraryPath = path.join(dir, "library.sqlite");
  db = openDb(dbPath, libraryPath);
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
  targets: [{ id: "ws1", dbPath, libraryPath }],
});

describe("QueryWorkerClient", () => {
  it("answers a query in flight from the fallback when the worker fails to start", async () => {
    // The worker bundle doesn't exist: the spawn dies with an async module
    // error before replying, so the query is retried on the main thread.
    const stats = await client.run<WorkspaceStats>(statsReq());
    expect(stats.fileCount).toBe(4);
  });

  it("replays a closeWorkspace sent after the query, so the fallback handle is closed", async () => {
    const fallbackDbs = (
      client as unknown as { fallback: { dbs: Map<string, unknown> } }
    ).fallback.dbs;
    const query = client.run(statsReq()); // spawns the worker that fails to start
    const closed = client.closeWorkspace("ws1"); // queued behind the query
    await query; // answered on the fallback, opening ws1 there
    await closed;
    expect(fallbackDbs.has("ws1")).toBe(false);
  });

  it("falls back to the main thread after repeated worker crashes", async () => {
    // Each request spawns a worker that dies on start; its query is still
    // answered from the fallback.
    for (let i = 0; i < 3; i++) {
      await expect(client.run(statsReq())).resolves.toMatchObject({
        fileCount: 4,
      });
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
    const bad = {
      kind: "search" as const,
      targets: [{ id: "ws1", dbPath, libraryPath }],
    };
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

// Stand-in workers speaking the real message protocol, for the paths the
// missing-bundle tests above never reach (a worker that started, dispose()'s
// closeAll-before-terminate).
function writeWorker(file: string, body: string): string {
  writeFileSync(
    file,
    `const { parentPort } = require("node:worker_threads");
const fs = require("node:fs");
parentPort.on("message", (m) => { ${body} });
`,
  );
  return file;
}

describe("QueryWorkerClient.dispose() with a live worker", () => {
  it("asks the worker to close its handles before terminating it", async () => {
    const marker = path.join(dir, "closed.marker");
    const script = writeWorker(
      path.join(dir, "worker-ok.js"),
      `if (m.type === "closeAll") fs.writeFileSync(${JSON.stringify(marker)}, "1");
       parentPort.postMessage({ id: m.id, ok: true, result: null });`,
    );
    const live = new QueryWorkerClient(script);
    await live.run(statsReq()); // spawns the worker
    await live.dispose();
    expect(existsSync(marker)).toBe(true);
    await expect(live.run(statsReq())).rejects.toThrow(/disposed/);
  });

  it("gives up on a worker that never answers within the dispose bound", async () => {
    const script = writeWorker(path.join(dir, "worker-silent.js"), "");
    const silent = new QueryWorkerClient(script);
    const inflight = silent.run(statsReq()).catch(() => "rejected"); // spawns
    await silent.dispose(); // bounded by DISPOSE_TIMEOUT_MS (< the test timeout)
    expect(await inflight).toBe("rejected"); // pending request was released
  });
});

describe("QueryWorkerClient with a live worker", () => {
  const badReq = () => ({
    kind: "search" as const,
    targets: [{ id: "ws1", dbPath, libraryPath }],
  });

  it("rejects the queries in flight when the worker crashes after a reply", async () => {
    const script = writeWorker(
      path.join(dir, "worker-crash.js"),
      `if (m.type === "query" && m.req.kind === "search") process.exit(1);
       parentPort.postMessage({ id: m.id, ok: true, result: null });`,
    );
    const crashing = new QueryWorkerClient(script);
    try {
      await crashing.run(statsReq()); // a reply: the worker started fine
      // Not retried on the main thread: the query may be what killed it.
      await expect(crashing.run(badReq() as never)).rejects.toThrow(/exited/);
    } finally {
      await crashing.dispose();
    }
  });

  it("rejects a query that kills a worker after it reported ready", async () => {
    const script = path.join(dir, "worker-ready-crash.js");
    writeFileSync(
      script,
      `const { parentPort } = require("node:worker_threads");
parentPort.on("message", () => process.exit(1));
parentPort.postMessage({ type: "ready" });
`,
    );
    const crashing = new QueryWorkerClient(script);
    try {
      // Its first message, but the worker had started: not a start failure.
      await expect(crashing.run(statsReq())).rejects.toThrow(/exited/);
    } finally {
      await crashing.dispose();
    }
  });
});
