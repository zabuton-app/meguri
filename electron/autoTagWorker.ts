// Auto-tag worker thread entry. Evaluates the auto-tagging engine off the main
// process: a rule is an arbitrary regular expression, and one that backtracks
// catastrophically on some file name cannot be interrupted where it runs — only
// the thread running it can be killed. Spawned by AutoTagWorkerClient, which
// is told which rule each chunk is on, so a rule that never finishes is the
// one left out, and not the whole engine.
//
// Only what reads a name is evaluated here: the rules and the keywords. Folder
// rules compare paths, which cannot hang, and are added by the caller. The
// engine is sent once and held; chunks carry only names. The protocol is in
// core/autoTagChunk.ts, where it is tested; this only wires it to the port.
import { parentPort } from "node:worker_threads";
import { handleRequests } from "./core/autoTagChunk.js";

export type {
  AutoTagWorkerReply,
  AutoTagWorkerRequest,
} from "./core/autoTagChunk.js";

const port = parentPort;
if (!port) throw new Error("autoTagWorker must run inside a worker thread");

port.on(
  "message",
  handleRequests((reply) => port.postMessage(reply)),
);
