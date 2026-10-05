// Non-component helpers shared by the auto-tagging tabs.
import type { TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import {
  MAX_AUTO_TAG_ALIASES,
  MAX_AUTO_TAG_KEYWORDS,
  cleanTagName,
  compileKeyword,
  compileRule,
  isUsableTagName,
  runKeyword,
  runRule,
  type BuiltinRuleId,
  type KeywordEntry,
  type KeywordHit,
  type AutoTagConfig,
  type TagRule,
} from "@shared/autoTag";
import { candidateGroup, type Candidate } from "@shared/autoTagAnalysis";

const BUILTIN_RULE_NAMES: Record<BuiltinRuleId, TranslationKey> = {
  prefix: "autoTag.rule.prefix",
  square: "autoTag.rule.square",
  sumi: "autoTag.rule.sumi",
  kagi: "autoTag.rule.kagi",
  paren: "autoTag.rule.paren",
};

/** A rule's name: what the user called it, else the built-in's, else its pattern. */
export function ruleDisplayName(t: TFunc, rule: TagRule): string {
  if (rule.name.trim()) return rule.name;
  const builtin = BUILTIN_RULE_NAMES[rule.id as BuiltinRuleId];
  return builtin ? t(builtin) : rule.pattern || t("autoTag.rule.untitled");
}

export const MONO = "font-mono";

export const FIELD =
  "h-[30px] rounded-md border border-border-strong bg-transparent px-2 text-[13px] text-bright-fg outline-none placeholder:text-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring";

/** Rows drawn per list at a time: a page of it, or all a preview shows. */
export const MAX_ROWS = 200;

/** A new dictionary entry, or null when the tag name is unusable or taken. */
export function newKeyword(
  keywords: readonly KeywordEntry[],
  rawTag: string,
  aliases: readonly string[],
): KeywordEntry | null {
  const tag = cleanTagName(rawTag);
  if (!isUsableTagName(tag)) return null;
  if (keywords.length >= MAX_AUTO_TAG_KEYWORDS) return null;
  if (keywords.some((k) => k.tag.toLowerCase() === tag.toLowerCase())) {
    return null;
  }
  return {
    id: crypto.randomUUID(),
    tag,
    aliases: cleanAliases(aliases, tag),
    mode: "word",
  };
}

/** Aliases as stored: trimmed, without repeats or the tag itself. */
export function cleanAliases(
  aliases: readonly string[],
  tag: string,
): string[] {
  const seen = new Set([tag.toLowerCase()]);
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = cleanTagName(raw);
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out.slice(0, MAX_AUTO_TAG_ALIASES);
}

/**
 * Where a suggestion stands. Two facts that do not follow from each other —
 * whether the keywords hold the tag, and whether the files carry it — plus the
 * user having dismissed it. Each is read from where it is kept (the
 * configuration, the files' tags) every time; nothing is remembered, not even
 * what the screen itself applied, so a row cannot say something the Conditions
 * tab or the library does not.
 */
export interface CandidateState {
  ignored: boolean;
  /** The keywords have an entry for the tag. */
  inKeywords: boolean;
  /**
   * An entry can be added: nothing on the Conditions tab produces the tag yet
   * (a rule's or a keyword's candidate is already managed there), and the
   * keywords have room.
   */
  canRegister: boolean;
  /** Files it names that do not carry the tag yet. */
  missing: number;
  /** Files it names that carry the tag, whoever put it there. */
  tagged: number;
  /**
   * Something is still to be decided: files to tag, or an entry to add. Never
   * for a tag the keywords hold — that was decided on the Conditions tab, and
   * the row only reports it (and can still tag the files that lack it) — and
   * never for a dismissed one: `ignored` comes before everything else here.
   */
  pending: boolean;
}

/** What `candidateState` reads; built once per render for the whole list. */
export interface CandidateContext {
  ignored: ReadonlySet<string>;
  /** Lowercased tags of the keyword entries. */
  keywordTags: ReadonlySet<string>;
  keywordsFull: boolean;
  fileTags: readonly Set<string>[];
}

export function candidateContext(
  config: Pick<AutoTagConfig, "ignored" | "keywords">,
  fileTags: readonly Set<string>[],
): CandidateContext {
  return {
    ignored: new Set(config.ignored),
    keywordTags: new Set(config.keywords.map((k) => k.tag.toLowerCase())),
    keywordsFull: config.keywords.length >= MAX_AUTO_TAG_KEYWORDS,
    fileTags,
  };
}

export function candidateState(
  c: Candidate,
  ctx: CandidateContext,
): CandidateState {
  const ignored = ctx.ignored.has(c.key);
  const inKeywords = ctx.keywordTags.has(c.key);
  // The candidates come from the configuration as last analyzed, the context
  // from the one being edited: a word can still read as "frequent" for a
  // moment after its entry was added, hence the second test.
  const unmanaged = candidateGroup(c) === "frequent" && !inKeywords;
  const canRegister = unmanaged && !ctx.keywordsFull;
  let missing = 0;
  for (const index of c.files.keys()) {
    if (!ctx.fileTags[index].has(c.key)) missing++;
  }
  return {
    ignored,
    inKeywords,
    canRegister,
    missing,
    tagged: c.files.size - missing,
    // What could be done about it: with the keywords full and the files
    // tagged there is nothing, and a row with no action is not waiting.
    pending: !ignored && !inKeywords && (missing > 0 || canRegister),
  };
}

// The two memos below are keyed per rule / entry object and per names array, so
// editing one leaves the results of the others alone. They rely on the
// configuration being updated immutably, and live outside React on purpose:
// they are pure.
const ruleCountCache = new WeakMap<
  TagRule,
  { names: readonly string[]; count: number }
>();

/** Files a rule would tag. */
export function ruleMatchCount(
  rule: TagRule,
  names: readonly string[],
): number {
  const cached = ruleCountCache.get(rule);
  if (cached?.names === names) return cached.count;
  let count = 0;
  const compiled = compileRule(rule);
  if (compiled) {
    for (const name of names) {
      if (runRule(compiled, name).some((hit) => hit.tags.length > 0)) count++;
    }
  }
  ruleCountCache.set(rule, { names, count });
  return count;
}

export type KeywordMatches = { name: string; hits: KeywordHit[] }[];

const keywordMatchCache = new WeakMap<
  KeywordEntry,
  { names: readonly string[]; rows: KeywordMatches }
>();

/** The files a dictionary entry finds, and where in each name. */
export function keywordMatches(
  entry: KeywordEntry,
  names: readonly string[],
): KeywordMatches {
  const cached = keywordMatchCache.get(entry);
  if (cached?.names === names) return cached.rows;
  const rows: KeywordMatches = [];
  const compiled = compileKeyword(entry);
  if (compiled) {
    // A plain substring test first: nearly every name fails it, and it costs a
    // fraction of running the expression. The expression then decides (word
    // boundaries, the extension), so the test may only ever let too much in.
    const needles = [entry.tag, ...entry.aliases]
      .map((term) => term.normalize("NFC").trim().toLowerCase())
      .filter(Boolean);
    for (const name of names) {
      const lower = name.toLowerCase();
      if (!needles.some((needle) => lower.includes(needle))) continue;
      const hits = runKeyword(compiled, name);
      if (hits.length > 0) rows.push({ name, hits });
    }
  }
  keywordMatchCache.set(entry, { names, rows });
  return rows;
}
