// One regex rule run over the library's names, for the screen: what it finds,
// kept small. Runs in rules.worker.ts — never on the screen's own thread,
// where a pattern that backtracks without end would hang it.
import {
  AUTO_TAG_CHUNK,
  compileRule,
  runRule,
  type RuleHit,
  type TagRule,
} from "@shared/autoTag";
import { isSuggestableWord } from "@shared/autoTagAnalysis";
import { MAX_ROWS } from "./helpers";

/**
 * What a rule finds, in a size that does not grow with how much it matches
 * beyond what the screen shows: the matches themselves only for the rows the
 * editor draws, and of the tags only what a suggestion has to know.
 */
export interface RuleResult {
  /** Names the rule gives at least one tag. */
  tagged: number;
  /** Positions of the names it matches at all (a match can be all excluded). */
  matched: Int32Array;
  /**
   * The matches, for the names the editor can draw: the first rows of the
   * library, and the first of the matched ones.
   */
  detail: [index: number, hits: RuleHit[]][];
  /** The suggestable words among the tags it gives each name, lowercased. */
  words: [index: number, words: string[]][];
}

/** Runs `rule` over `names`; `onChunk` is called after every chunk of them. */
export function evaluateRule(
  rule: TagRule,
  names: readonly string[],
  onChunk?: () => void,
): RuleResult {
  const result: RuleResult = {
    tagged: 0,
    matched: new Int32Array(0),
    detail: [],
    words: [],
  };
  const compiled = compileRule(rule);
  if (!compiled) return result;
  const matched: number[] = [];
  names.forEach((name, index) => {
    const hits = runRule(compiled, name);
    if (hits.length > 0) {
      matched.push(index);
      if (index < MAX_ROWS || matched.length <= MAX_ROWS) {
        result.detail.push([index, hits]);
      }
      const words = new Set<string>();
      let tagged = false;
      for (const hit of hits) {
        for (const tag of hit.tags) {
          tagged = true;
          if (isSuggestableWord(tag)) words.add(tag.toLowerCase());
        }
      }
      if (tagged) result.tagged++;
      if (words.size > 0) result.words.push([index, [...words]]);
    }
    if (onChunk && (index + 1) % AUTO_TAG_CHUNK === 0) onChunk();
  });
  result.matched = Int32Array.from(matched);
  return result;
}
