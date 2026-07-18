// Query worker thread entry. Runs the heavy read-only list/search queries off
// the main process so a slow query can no longer stall the UI, IPC, or media
// serving (better-sqlite3 is synchronous — on the main thread every query is
// event-loop blocking time). Spawned by QueryWorkerClient; one request at a
// time is executed per message (the client correlates responses by id).
import { parentPort } from "node:worker_threads";
import { QueryExecutor, type QueryRequest } from "./core/queryExec.js";

export type WorkerPayload =
  | { type: "query"; req: QueryRequest }
  | { type: "closeWorkspace"; wsId: string }
  | { type: "closeAll" };

export type WorkerMessage = WorkerPayload & { id: number };

export type WorkerReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

const port = parentPort;
if (!port) throw new Error("queryWorker must run inside a worker thread");

// The electron-log logger needs the electron module (unavailable in a worker
// thread); console.warn reaches the main process's stderr in dev builds.
const exec = new QueryExecutor((message) =>
  console.warn(`[queryWorker] ${message}`),
);

port.on("message", (msg: WorkerMessage) => {
  try {
    let result: unknown;
    switch (msg.type) {
      case "query":
        result = exec.run(msg.req);
        break;
      case "closeWorkspace":
        exec.closeWorkspace(msg.wsId);
        break;
      case "closeAll":
        exec.closeAll();
        break;
      default:
        // Exhaustive at the type level; guard at runtime so a protocol
        // mismatch fails loudly instead of replying ok with no effect.
        throw new Error(
          `unknown worker message type: ${String((msg as { type?: unknown }).type)}`,
        );
    }
    port.postMessage({ id: msg.id, ok: true, result } satisfies WorkerReply);
  } catch (e) {
    port.postMessage({
      id: msg.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    } satisfies WorkerReply);
  }
});
