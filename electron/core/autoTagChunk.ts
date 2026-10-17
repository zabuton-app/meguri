// What the auto-tagging worker does with one chunk of names, apart from the
// worker so it can be tested: the rules are run one at a time over every name
// of the chunk, and `onStep` hears which one is about to run — then, with
// null, that the keywords are. When the worker never finishes, the step last
// heard of is where it is stuck (see AutoTagWorkerClient). The tags are the
// ones tagsForName gives.
import {
  MAX_AUTO_TAGS_PER_FILE,
  firstSpellings,
  keywordTags,
  runRule,
  type CompiledEngine,
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
