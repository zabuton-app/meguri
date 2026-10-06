// Non-component helpers shared by the auto-tagging tabs.
import type { TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import {
  MAX_AUTO_TAG_FOLDER_TAGS,
  MAX_AUTO_TAG_KEYWORD_TAGS,
  MAX_AUTO_TAG_KEYWORD_TERMS,
  MAX_AUTO_TAG_KEYWORDS,
  cleanTagName,
  compileKeyword,
  compileRule,
  isUnderFolder,
  isUsableTagName,
  runKeyword,
  runRule,
  type BuiltinRuleId,
  type KeywordEntry,
  type KeywordHit,
  type AutoTagConfig,
  type AutoTagFile,
  type TagRule,
} from "@shared/autoTag";
import type { Candidate } from "@shared/autoTagAnalysis";
import { ROOT_FOLDER, parentOf } from "@shared/folderPath";

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

/**
 * A new dictionary entry, or null when the first term cannot name a tag, the
 * keywords are full, or one of the terms is already an entry's.
 */
export function newKeyword(
  keywords: readonly KeywordEntry[],
  rawTerms: readonly string[],
  existing: ReadonlyMap<string, string>,
): KeywordEntry | null {
  const terms = cleanTerms(rawTerms);
  const first = terms[0];
  if (!first || !isUsableTagName(first)) return null;
  if (keywords.length >= MAX_AUTO_TAG_KEYWORDS) return null;
  // One entry per term: a second one for the same word would only repeat it.
  const keys = new Set(terms.map((term) => term.toLowerCase()));
  if (keywords.some((k) => k.terms.some((t) => keys.has(t.toLowerCase())))) {
    return null;
  }
  return {
    id: crypto.randomUUID(),
    terms,
    // The first term names the tag to begin with.
    tags: addKeywordTags([], [first], existing),
    mode: "word",
  };
}

/** Terms as stored: trimmed, without repeats. */
export function cleanTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = cleanTagName(raw);
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out.slice(0, MAX_AUTO_TAG_KEYWORD_TERMS);
}

/**
 * Tags as stored, with more added: trimmed, usable, without repeats, in the
 * spelling already in use for one the library has.
 */
export function mergeTags(
  have: readonly string[],
  raw: readonly string[],
  existing: ReadonlyMap<string, string>,
  max: number,
): string[] {
  const keys = new Set(have.map((tag) => tag.toLowerCase()));
  const out = [...have];
  for (const text of raw) {
    const tag = cleanTagName(text);
    const key = tag.toLowerCase();
    if (!isUsableTagName(tag) || keys.has(key)) continue;
    if (out.length >= max) break;
    keys.add(key);
    out.push(existing.get(key) ?? tag);
  }
  return out;
}

/**
 * `tags` with `from` renamed to what `raw` cleans to — in the spelling already
 * in use for a tag the library has, and without a repeat when the list holds
 * the new name already. Null when nothing changes: an unusable name, or the
 * same one.
 */
export function renameTag(
  tags: readonly string[],
  from: string,
  raw: string,
  existing: ReadonlyMap<string, string>,
): { tags: string[]; to: string } | null {
  const cleaned = cleanTagName(raw);
  if (!isUsableTagName(cleaned)) return null;
  const key = cleaned.toLowerCase();
  // The list's own spelling of the name, when it holds it already.
  const held = tags.find((tag) => tag !== from && tag.toLowerCase() === key);
  const to = held ?? existing.get(key) ?? cleaned;
  if (to === from || !tags.includes(from)) return null;
  const out: string[] = [];
  for (const tag of tags) {
    if (tag !== from) out.push(tag);
    else if (held === undefined) out.push(to);
  }
  return { tags: out, to };
}

/** {@link mergeTags} for a keyword entry. */
export const addKeywordTags = (
  have: readonly string[],
  raw: readonly string[],
  existing: ReadonlyMap<string, string>,
): string[] => mergeTags(have, raw, existing, MAX_AUTO_TAG_KEYWORD_TAGS);

/** {@link mergeTags} for a folder rule. */
export const addFolderTags = (
  have: readonly string[],
  raw: readonly string[],
  existing: ReadonlyMap<string, string>,
): string[] => mergeTags(have, raw, existing, MAX_AUTO_TAG_FOLDER_TAGS);

/**
 * Where a suggestion stands: whether the files carry the word as a tag, and
 * whether the user dismissed it. Each is read from where it is kept (the
 * configuration, the files' tags) every time; nothing is remembered, not even
 * what the screen itself applied, so a row cannot say something the condition
 * tabs or the library do not. A word the keywords hold is no suggestion at
 * all (suggestCandidates leaves it out), so there is no state for that.
 */
export interface CandidateState {
  ignored: boolean;
  /** An entry can be added: the keywords have room. */
  canRegister: boolean;
  /** Files it names that do not carry the tag yet. */
  missing: number;
  /** Files it names that carry the tag, whoever put it there. */
  tagged: number;
  /**
   * Something is still to be decided: files to tag, or an entry to add. Never
   * for a dismissed one: `ignored` comes before everything else here.
   */
  pending: boolean;
}

/** What `candidateState` reads; built once per render for the whole list. */
export interface CandidateContext {
  ignored: ReadonlySet<string>;
  keywordsFull: boolean;
  fileTags: readonly Set<string>[];
}

export function candidateContext(
  config: Pick<AutoTagConfig, "ignored" | "keywords">,
  fileTags: readonly Set<string>[],
): CandidateContext {
  return {
    ignored: new Set(config.ignored),
    keywordsFull: config.keywords.length >= MAX_AUTO_TAG_KEYWORDS,
    fileTags,
  };
}

export function candidateState(
  c: Candidate,
  ctx: CandidateContext,
): CandidateState {
  const ignored = ctx.ignored.has(c.key);
  // The candidates come from the configuration as last analyzed: a word is
  // still listed for a moment after its entry was added, and goes once the
  // analysis has caught up. (newKeyword refuses the entry twice meanwhile.)
  const canRegister = !ctx.keywordsFull;
  let missing = 0;
  for (const index of c.files.keys()) {
    if (!ctx.fileTags[index].has(c.key)) missing++;
  }
  return {
    ignored,
    canRegister,
    missing,
    tagged: c.files.size - missing,
    // What could be done about it: with the keywords full and the files
    // tagged there is nothing, and a row with no action is not waiting.
    pending: !ignored && (missing > 0 || canRegister),
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

export type KeywordMatches = {
  /** The file's position in the names. */
  index: number;
  name: string;
  hits: KeywordHit[];
}[];

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
  // A plain substring test first: nearly every name fails it, and it costs a
  // fraction of running the expression. The expression then decides (word
  // boundaries, the extension), so the test may only ever let too much in.
  const needles = entry.terms
    .map((term) => term.normalize("NFC").trim().toLowerCase())
    .filter(Boolean);
  names.forEach((name, index) => {
    const lower = name.toLowerCase();
    if (!needles.some((needle) => lower.includes(needle))) return;
    const hits = runKeyword(compiled, name);
    if (hits.length > 0) rows.push({ index, name, hits });
  });
  keywordMatchCache.set(entry, { names, rows });
  return rows;
}

/**
 * The files a folder rule reaches, by position: the ones of its workspace
 * under its folder, subfolders included — as a scan decides it (foldersFor).
 * What the editor lists and what a renamed tag is moved on are both this.
 */
export function folderFileIndexes(
  files: readonly AutoTagFile[],
  rule: { workspaceId: string; folder: string },
): number[] {
  const out: number[] = [];
  files.forEach((file, index) => {
    if (
      file.workspaceId === rule.workspaceId &&
      isUnderFolder(file.folder, rule.folder)
    ) {
      out.push(index);
    }
  });
  return out;
}

/**
 * How many files are under each folder of each workspace, subfolders counted
 * in: one pass over the files instead of one per folder rule. The key is
 * {@link folderCountKey}; a workspace's root ("") counts all of it.
 */
export function folderCounts(
  files: readonly AutoTagFile[],
): ReadonlyMap<string, number> {
  const own = new Map<string, number>();
  for (const file of files) {
    const key = folderCountKey(file.workspaceId, file.folder);
    own.set(key, (own.get(key) ?? 0) + 1);
  }
  // Each folder's own files count for every folder above it too.
  const all = new Map<string, number>();
  for (const [key, count] of own) {
    const at = key.indexOf("\0");
    const workspaceId = key.slice(0, at);
    let folder = key.slice(at + 1);
    for (;;) {
      const up = folderCountKey(workspaceId, folder);
      all.set(up, (all.get(up) ?? 0) + count);
      if (folder === ROOT_FOLDER) break;
      folder = parentOf(folder);
    }
  }
  return all;
}

export const folderCountKey = (workspaceId: string, folder: string): string =>
  `${workspaceId}\0${folder}`;
