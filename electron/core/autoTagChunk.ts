// What the auto-tagging worker does with one chunk of names, apart from the
// worker so it can be tested: the rules are run one at a time over every name
// of the chunk, and `onStep` hears which one is about to run — then, with
// null, that the keywords are. When the worker never finishes, the step last
// heard of is where it is stuck (see AutoTagWorkerClient). The tags are the
// ones tagsForName gives.
//
// The worker's protocol is here too (AutoTagWorkerRequest, handleRequests), so
// what the worker runs is what the tests run.
import {
  MAX_AUTO_TAGS_PER_FILE,
  compileEngine,
  firstSpellings,
  keywordTags,
  runRule,
  type CompiledEngine,
  type KeywordEntry,
  type TagRule,
} from "../../shared/autoTag.js";

export function deriveChunk(
  engine: CompiledEngine,
  names: readonly string[],
  /** `at` is the rule's place in engine.rules; null, the keywords. */
  onStep?: (at: number | null) => void,
): string[][] {
  const inputs = names.map((name) => name.normalize("NFC"));
  const fromRules: string[][] = inputs.map(() => []);
  engine.rules.forEach((compiled, at) => {
    onStep?.(at);
    inputs.forEach((input, i) => {
      // A name already given all it can be needs no more of the rules.
      if (firstSpellings(fromRules[i]).length >= MAX_AUTO_TAGS_PER_FILE) {
        return;
      }
      try {
        for (const hit of runRule(compiled, input)) {
          fromRules[i].push(...hit.tags);
        }
      } catch {
        // The expression gave up on this name (a stack overflow, say): it
        // gives the name nothing, and the other rules still run.
      }
    });
  });
  // The keywords are escaped literals: they cannot hang. Said all the same,
  // so a slow stretch here is never blamed on the last rule.
  onStep?.(null);
  return inputs.map((input, i) =>
    firstSpellings([...fromRules[i], ...keywordTags(engine, input)]),
  );
}

/**
 * Engines a worker holds at once. More than one, so passes that run side by
 * side (every workspace scanned at once, a scan during "Apply to existing
 * files") do not push each other's engine out at every chunk. The oldest sent
 * goes first, and the client counts the same way (AutoTagWorkerClient).
 */
export const AUTO_TAG_ENGINES_HELD = 4;

/**
 * What the client posts. An engine crosses once, under a version the client
 * picks; each chunk then names the version it is for and carries only names.
 */
export type AutoTagWorkerRequest =
  | {
      type: "engine";
      version: number;
      rules: TagRule[];
      keywords: KeywordEntry[];
    }
  | {
      type: "derive";
      id: number;
      version: number;
      /** File names; one list of tags comes back per name, in order. */
      names: string[];
    };

export type AutoTagWorkerReply =
  /**
   * About to run rule `at` of the version's rules over its names — or, with
   * null, the keywords. The same shape as the screen's worker uses.
   */
  | { type: "start"; id: number; at: number | null }
  | { type: "done"; id: number; tags: string[][] }
  | { type: "failed"; id: number; error: string }
  /**
   * The chunk names a version this worker does not hold. The client sends
   * an engine before any chunk the worker would not have it for, so this is
   * a safety net for the two counting differently, not a step of the protocol.
   */
  | { type: "unknownEngine"; id: number };

type Held =
  /** `sentAt`: where each compiled rule sits in the rules sent — the rules
   *  switched off or that do not compile are left out of the engine. */
  | { engine: CompiledEngine; sentAt: number[] }
  /** It did not compile: reported on each chunk for it. */
  | { error: string };

/** The worker's side of the protocol: a handler for each message, in order. */
export function handleRequests(
  post: (reply: AutoTagWorkerReply) => void,
): (msg: AutoTagWorkerRequest) => void {
  const held = new Map<number, Held>();
  return (msg) => {
    if (msg.type === "engine") {
      try {
        const engine = compileEngine(msg);
        held.set(msg.version, {
          engine,
          sentAt: engine.rules.map((compiled) =>
            msg.rules.indexOf(compiled.rule),
          ),
        });
      } catch (e) {
        held.set(msg.version, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      // Oldest first: a Map keeps the order its keys were set in.
      while (held.size > AUTO_TAG_ENGINES_HELD) {
        held.delete(held.keys().next().value as number);
      }
      return;
    }
    const version = held.get(msg.version);
    if (!version) {
      post({ type: "unknownEngine", id: msg.id });
      return;
    }
    try {
      if ("error" in version) throw new Error(version.error);
      const { engine, sentAt } = version;
      const tags = deriveChunk(engine, msg.names, (at) =>
        post({
          type: "start",
          id: msg.id,
          at: at === null ? null : sentAt[at],
        }),
      );
      post({ type: "done", id: msg.id, tags });
    } catch (e) {
      post({
        type: "failed",
        id: msg.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
}
