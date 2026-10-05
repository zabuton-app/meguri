// Auto-tag worker thread entry. Evaluates the auto-tagging engine off the main
// process: a rule is an arbitrary regular expression, and one that backtracks
// catastrophically on some file name cannot be interrupted where it runs — only
// the thread running it can be killed. Spawned by AutoTagWorkerClient.
import { parentPort } from "node:worker_threads";
import {
  compileEngine,
  tagsForName,
  type CompiledEngine,
  type KeywordEntry,
  type TagRule,
} from "../shared/autoTag.js";

export interface AutoTagWorkerRequest {
  id: number;
  rules: TagRule[];
  keywords: KeywordEntry[];
  /** File names; one list of tags comes back per name, in order. */
  names: string[];
}

export type AutoTagWorkerReply =
  | { id: number; ok: true; tags: string[][] }
  | { id: number; ok: false; error: string };

const port = parentPort;
if (!port) throw new Error("autoTagWorker must run inside a worker thread");

// A pass sends the same engine with every chunk; compile it once.
let cached: { key: string; engine: CompiledEngine } | null = null;

port.on("message", (msg: AutoTagWorkerRequest) => {
  try {
    const key = JSON.stringify([msg.rules, msg.keywords]);
    if (cached?.key !== key) {
      cached = { key, engine: compileEngine(msg) };
    }
    const { engine } = cached;
    const tags = msg.names.map((name) => tagsForName(engine, name));
    port.postMessage({
      id: msg.id,
      ok: true,
      tags,
    } satisfies AutoTagWorkerReply);
  } catch (e) {
    port.postMessage({
      id: msg.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    } satisfies AutoTagWorkerReply);
  }
});
