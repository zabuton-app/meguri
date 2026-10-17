// Auto-tag worker thread entry. Evaluates the auto-tagging engine off the main
// process: a rule is an arbitrary regular expression, and one that backtracks
// catastrophically on some file name cannot be interrupted where it runs — only
// the thread running it can be killed. Spawned by AutoTagWorkerClient, which
// is told which rule each chunk is on, so a rule that never finishes is the
// one left out, and not the whole engine.
//
// Only what reads a name is evaluated here: the rules and the keywords. Folder
// rules compare paths, which cannot hang, and are added by the caller.
import { parentPort } from "node:worker_threads";
import { deriveChunk } from "./core/autoTagChunk.js";
import {
  compileEngine,
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
  /**
   * About to run rule `at` of the request's rules over its names — or, with
   * null, the keywords. The same shape as the screen's worker uses.
   */
  | { type: "start"; id: number; at: number | null }
  | { type: "done"; id: number; tags: string[][] }
  | { type: "failed"; id: number; error: string };

const port = parentPort;
if (!port) throw new Error("autoTagWorker must run inside a worker thread");

// A pass sends the same engine with every chunk; compile it once. `sentAt`
// is where each compiled rule sits in the rules sent — the rules switched off
// or that do not compile are left out of the engine, so the two differ.
let cached: { key: string; engine: CompiledEngine; sentAt: number[] } | null =
  null;

port.on("message", (msg: AutoTagWorkerRequest) => {
  try {
    const key = JSON.stringify([msg.rules, msg.keywords]);
    if (cached?.key !== key) {
      const engine = compileEngine(msg);
      cached = {
        key,
        engine,
        sentAt: engine.rules.map((compiled) =>
          msg.rules.indexOf(compiled.rule),
        ),
      };
    }
    const { engine, sentAt } = cached;
    const tags = deriveChunk(engine, msg.names, (at) =>
      port.postMessage({
        type: "start",
        id: msg.id,
        at: at === null ? null : sentAt[at],
      } satisfies AutoTagWorkerReply),
    );
    port.postMessage({
      type: "done",
      id: msg.id,
      tags,
    } satisfies AutoTagWorkerReply);
  } catch (e) {
    port.postMessage({
      type: "failed",
      id: msg.id,
      error: e instanceof Error ? e.message : String(e),
    } satisfies AutoTagWorkerReply);
  }
});
