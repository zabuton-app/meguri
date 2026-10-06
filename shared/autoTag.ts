/**
 * Auto-tagging engine, shared by both processes.
 *
 * Two things read a file's name and propose tags: pattern rules (a regular
 * expression whose matches name tags through a template) and a keyword
 * dictionary (a tag plus its aliases). The tags are the user's own — plain
 * names, no namespace — so applying them is the same act as tagging by hand.
 *
 * Everything here is pure. The scan runs it in a worker thread, and the
 * auto-tagging screen runs the very same code to preview and suggest,
 * so what the screen shows is what a scan writes.
 */
import { MAX_TAG_NAME, isReservedTagName } from "./tags.js";

export const MAX_AUTO_TAG_RULES = 64;
export const MAX_AUTO_TAG_KEYWORDS = 500;
export const MAX_AUTO_TAG_ALIASES = 32;
export const MAX_AUTO_TAG_PATTERN = 256;
export const MAX_AUTO_TAG_TEMPLATE = 64;
/**
 * Characters of a rule's exclude list, one value to a line: room for a few
 * thousand values, which is a list kept by hand for a long time.
 */
export const MAX_AUTO_TAG_EXCLUDE = 32_768;
export const MAX_AUTO_TAG_RULE_NAME = 64;
export const MAX_AUTO_TAG_TERMS = 5000;
/** Matches one rule may take from one name; a pattern that matches everywhere stops here. */
export const MAX_RULE_MATCHES = 50;
/** Tags the engine may put on one file. */
export const MAX_AUTO_TAGS_PER_FILE = 64;

export const RULE_KINDS = ["prefix", "bracket", "regex"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const CASE_MODES = ["keep", "lower", "upper"] as const;
export type CaseMode = (typeof CASE_MODES)[number];

export const KEYWORD_MODES = ["word", "contains"] as const;
export type KeywordMode = (typeof KEYWORD_MODES)[number];

export interface TagRule {
  id: string;
  /** Empty for a built-in rule the user has not renamed; the UI labels it by id. */
  name: string;
  /** Presentation only: which badge the rule list shows. */
  kind: RuleKind;
  /** JavaScript regular expression source, run globally over the name. */
  pattern: string;
  /** Tag name per match: `$1`–`$9` are capture groups; plain text is allowed. */
  template: string;
  /** Comma-separated values that never become tags (case-insensitive). */
  exclude: string;
  /** Case-insensitive matching. */
  ci: boolean;
  /** Split the produced value on , 、 / ／ ・ into several tags. */
  split: boolean;
  caseMode: CaseMode;
  enabled: boolean;
}

export interface KeywordEntry {
  id: string;
  /** The tag applied when the tag itself or any alias is found. */
  tag: string;
  aliases: string[];
  /** `word`: ASCII terms must stand alone between non-alphanumerics. */
  mode: KeywordMode;
}

export interface AutoTagConfig {
  rules: TagRule[];
  keywords: KeywordEntry[];
  /** Run the engine on files a scan adds or changes. */
  applyOnScan: boolean;
  /** Suggestions the user dismissed (lowercase), so they are not offered again. */
  ignored: string[];
  /**
   * Terms that are never offered as tags (lowercase). Nothing on the screen
   * edits this list at present — the tab that did was removed — but what is
   * stored is still read, as stop words for the suggestions.
   */
  excludedTerms: string[];
}

/** Ids of the built-in rules; the UI has a localized name for each. */
export const BUILTIN_RULE_IDS = [
  "prefix",
  "square",
  "sumi",
  "kagi",
  "paren",
] as const;
export type BuiltinRuleId = (typeof BUILTIN_RULE_IDS)[number];

export const PREFIX_PATTERN = "^([A-Z]{2,6})-\\d{2,5}";

const builtin = (
  id: BuiltinRuleId,
  kind: RuleKind,
  pattern: string,
  rest: Partial<TagRule> = {},
): TagRule => ({
  id,
  name: "",
  kind,
  pattern,
  template: "$1",
  exclude: "",
  ci: false,
  split: kind === "bracket",
  caseMode: "keep",
  // Off until the user turns it on: what suits one library's file names
  // makes noise in another's.
  enabled: false,
  ...rest,
});

/** The built-in rules as they ship: all there to look at, none switched on. */
export function defaultRules(): TagRule[] {
  return [
    builtin("prefix", "prefix", PREFIX_PATTERN, {
      exclude: formatExclude(["IMG", "DSC", "MVI"]),
    }),
    builtin("square", "bracket", "\\[([^\\]]+)\\]"),
    builtin("sumi", "bracket", "【([^】]+)】", { exclude: "公式" }),
    builtin("kagi", "bracket", "「([^」]+)」"),
    builtin("paren", "bracket", "[(（]([^)）]+)[)）]"),
  ];
}

const isBuiltinRule = (rule: TagRule): boolean =>
  (BUILTIN_RULE_IDS as readonly string[]).includes(rule.id);

/**
 * The rules with the built-in ones put back as they ship — restored where they
 * were deleted, their patterns and options as they were before any edit, and
 * switched off — ahead of the rules the user added. Those are all kept: when
 * the list has no room for every built-in rule beside them, it is the last of
 * the built-in ones that stay out.
 */
export function resetBuiltinRules(rules: readonly TagRule[]): TagRule[] {
  const own = rules.filter((rule) => !isBuiltinRule(rule));
  const room = Math.max(0, MAX_AUTO_TAG_RULES - own.length);
  return [...defaultRules().slice(0, room), ...own];
}

/** Whether a reset would change nothing: the one definition of "as shipped". */
export function builtinRulesAsShipped(rules: readonly TagRule[]): boolean {
  const reset = resetBuiltinRules(rules);
  return (
    reset.length === rules.length &&
    reset.every((rule, i) => {
      const mine = rules[i];
      // Field by field; every field of a rule is a plain value. The exclude
      // list is compared by what it holds, not by how it is laid out: a list
      // kept on one line with commas is the same list.
      return (Object.keys(rule) as (keyof TagRule)[]).every((key) =>
        key === "exclude"
          ? formatExclude(excludeValues(mine.exclude)) ===
            formatExclude(excludeValues(rule.exclude))
          : mine[key] === rule[key],
      );
    })
  );
}

/**
 * The starting configuration. Nothing is tagged until the user turns it on —
 * neither a rule nor the scan: the built-in rules are a starting point to look
 * at, not something to run over a library unasked.
 */
export function defaultAutoTagConfig(): AutoTagConfig {
  return {
    rules: defaultRules(),
    keywords: [],
    applyOnScan: false,
    ignored: [],
    excludedTerms: ["dsc", "img", "mvi", "公式"],
  };
}

/** The part of a path the engine reads: the file name. */
export function fileNameOf(relPath: string): string {
  return relPath.slice(
    Math.max(relPath.lastIndexOf("/"), relPath.lastIndexOf("\\")) + 1,
  );
}

/** A file name without its extension. Positions in it are positions in the name. */
export function stripExt(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{2,4}$/, "");
}

/**
 * A tag name as it is stored. Control and format characters go — a file name
 * can carry zero-width or bidi marks, which would make tags that look identical
 * and are not — and the cut is by code point, never through a surrogate pair.
 */
export function cleanTagName(raw: string): string {
  let name = raw
    .normalize("NFC")
    // Whitespace first: a tab or a newline is a control character too, and
    // must become a space rather than vanish. Collapsed again afterwards, since
    // removing a zero-width character can leave two spaces side by side.
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  if (name.length <= MAX_TAG_NAME) return name;
  // MAX_TAG_NAME counts UTF-16 units everywhere else (the IPC schemas, the
  // inputs), so cut to that — but by code point, never through a pair.
  const points = Array.from(name);
  while (name.length > MAX_TAG_NAME) {
    points.pop();
    name = points.join("");
  }
  return name.trim();
}

/** Whether the engine may produce this tag at all. */
export function isUsableTagName(name: string): boolean {
  return name !== "" && !isReservedTagName(name);
}

export const SPLIT_PATTERN = /[,、/／・]/;

/**
 * The values of an exclude list as written, one to a line — a comma separates
 * them as well, which is how the list was kept before it had lines. Blank
 * entries go, and so does a value that repeats an earlier one in another case.
 */
export function excludeValues(exclude: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of exclude.split(/[\n\r,、]+/)) {
    const value = part.trim();
    const key = value.toLowerCase();
    if (value === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** The list as it is stored and shown: one value to a line. */
export function formatExclude(values: readonly string[]): string {
  return values.join("\n");
}

/** What a rule's matches are checked against: the values, lowercased. */
export function parseExclude(exclude: string): Set<string> {
  return new Set(excludeValues(exclude).map((value) => value.toLowerCase()));
}

/**
 * Compile a rule's pattern, or the error message when it is not valid.
 *
 * Unicode mode is tried first so `\p{…}` classes work, then the legacy mode:
 * patterns people paste in often carry escapes (`\-`) that Unicode mode rejects.
 */
export function compilePattern(
  pattern: string,
  ci: boolean,
): { regex: RegExp } | { error: string } {
  if (!pattern) return { error: "" };
  if (pattern.length > MAX_AUTO_TAG_PATTERN) return { error: "too long" };
  const flags = ci ? "gi" : "g";
  let message = "";
  for (const mode of ["u", ""]) {
    try {
      return { regex: new RegExp(pattern, flags + mode) };
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
  }
  return { error: message };
}

/** A span of a file name, in UTF-16 offsets into the name. */
export interface Range {
  start: number;
  end: number;
}

export interface RuleHit extends Range {
  /** Tags the match produced; empty when every value was excluded. */
  tags: string[];
}

export interface CompiledRule {
  rule: TagRule;
  regex: RegExp;
  /** Lowercased; a set, since the list can run to thousands of values. */
  exclude: ReadonlySet<string>;
}

export function compileRule(rule: TagRule): CompiledRule | null {
  const compiled = compilePattern(rule.pattern, rule.ci);
  if ("error" in compiled) return null;
  return { rule, regex: compiled.regex, exclude: parseExclude(rule.exclude) };
}

/** Every match of one rule in a file name. */
export function runRule(compiled: CompiledRule, name: string): RuleHit[] {
  const { rule, regex, exclude } = compiled;
  const base = stripExt(name);
  const hits: RuleHit[] = [];
  let count = 0;
  for (const match of base.matchAll(regex)) {
    if (match[0] === "") continue;
    if (++count > MAX_RULE_MATCHES) break;
    const raw = rule.template.replace(
      /\$(\d)/g,
      (_whole, d: string) => match[Number(d)] ?? "",
    );
    const tags: string[] = [];
    for (const part of rule.split ? raw.split(SPLIT_PATTERN) : [raw]) {
      // Case first: folding can change the length (ß becomes SS).
      const cased =
        rule.caseMode === "lower"
          ? part.toLowerCase()
          : rule.caseMode === "upper"
            ? part.toUpperCase()
            : part;
      const tag = cleanTagName(cased);
      if (!isUsableTagName(tag) || exclude.has(tag.toLowerCase())) continue;
      tags.push(tag);
    }
    const start = match.index ?? 0;
    hits.push({ start, end: start + match[0].length, tags });
  }
  return hits;
}

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// eslint-disable-next-line no-control-regex
const ASCII_ONLY = /^[\x00-\x7f]+$/;

export interface CompiledKeyword {
  entry: KeywordEntry;
  tag: string;
  /** Every term of the entry as one alternation, or null when it has none. */
  regex: RegExp | null;
}

export function compileKeyword(entry: KeywordEntry): CompiledKeyword | null {
  const tag = cleanTagName(entry.tag);
  if (!isUsableTagName(tag)) return null;
  const sources: string[] = [];
  for (const raw of [entry.tag, ...entry.aliases]) {
    const term = raw.normalize("NFC").trim();
    if (!term) continue;
    // Word mode only means something for ASCII: Japanese has no word breaks to
    // anchor on, so those terms always match as substrings.
    sources.push(
      entry.mode === "word" && ASCII_ONLY.test(term)
        ? `(?<![A-Za-z0-9])${escapeRegExp(term)}(?![A-Za-z0-9])`
        : escapeRegExp(term),
    );
  }
  // One expression per entry rather than one per term: the dictionary is run
  // against every file name, and the count of expressions is what that costs.
  // Longest first, so a term is not cut short by one it starts with.
  sources.sort((a, b) => b.length - a.length);
  return {
    entry,
    tag,
    regex: sources.length > 0 ? new RegExp(sources.join("|"), "gi") : null,
  };
}

export interface KeywordHit extends Range {
  /** The spelling found in the name. */
  text: string;
}

/**
 * Every place one dictionary entry is found in a file name. Like the rules, it
 * reads the name without its extension — `mov` must not match every `.mov`.
 */
export function runKeyword(
  compiled: CompiledKeyword,
  name: string,
): KeywordHit[] {
  if (!compiled.regex) return [];
  const hits: KeywordHit[] = [];
  for (const match of stripExt(name).matchAll(compiled.regex)) {
    if (match[0] === "") continue;
    const start = match.index ?? 0;
    hits.push({ start, end: start + match[0].length, text: match[0] });
  }
  return hits;
}

export interface CompiledEngine {
  rules: CompiledRule[];
  keywords: CompiledKeyword[];
}

/** The rules and keywords that actually run: enabled, and valid. */
export function compileEngine(config: {
  rules: readonly TagRule[];
  keywords: readonly KeywordEntry[];
}): CompiledEngine {
  const rules: CompiledRule[] = [];
  for (const rule of config.rules) {
    if (!rule.enabled) continue;
    const compiled = compileRule(rule);
    if (compiled) rules.push(compiled);
  }
  const keywords: CompiledKeyword[] = [];
  for (const entry of config.keywords) {
    const compiled = compileKeyword(entry);
    if (compiled) keywords.push(compiled);
  }
  return { rules, keywords };
}

export type ProposalSource =
  { kind: "rule"; ruleId: string } | { kind: "keyword"; keywordId: string };

export interface Proposal {
  tag: string;
  /** Lowercased tag: what makes two proposals the same tag. */
  key: string;
  source: ProposalSource;
}

/**
 * The tags the engine gives one file, rules first, then the dictionary. Tag
 * names are compared case-insensitively and the first spelling wins. The input
 * is normalized (NFC) so a decomposed name from macOS matches a typed keyword.
 */
export function proposalsFor(engine: CompiledEngine, name: string): Proposal[] {
  const input = name.normalize("NFC");
  const out: Proposal[] = [];
  const seen = new Set<string>();
  const add = (tag: string, source: ProposalSource): boolean => {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ tag, key, source });
    }
    return out.length < MAX_AUTO_TAGS_PER_FILE;
  };
  for (const compiled of engine.rules) {
    for (const hit of runRule(compiled, input)) {
      for (const tag of hit.tags) {
        if (!add(tag, { kind: "rule", ruleId: compiled.rule.id })) return out;
      }
    }
  }
  for (const compiled of engine.keywords) {
    if (runKeyword(compiled, input).length === 0) continue;
    if (!add(compiled.tag, { kind: "keyword", keywordId: compiled.entry.id })) {
      return out;
    }
  }
  return out;
}

/** {@link proposalsFor}, names only. */
export function tagsForName(engine: CompiledEngine, name: string): string[] {
  return proposalsFor(engine, name).map((p) => p.tag);
}

// ---------------------------------------------------------------------------
// What crosses the IPC boundary for the auto-tagging screen.
// ---------------------------------------------------------------------------

/** Files the screen loads at most; a larger scope is analyzed from this sample. */
export const MAX_AUTO_TAG_FILES = 50_000;

/**
 * (file, tag) pairs one apply call may carry. The file count alone does not
 * bound the work: every pair is a statement inside one synchronous transaction.
 */
export const MAX_AUTO_TAG_PAIRS = 20_000;

export interface AutoTagFile {
  workspaceId: string;
  id: number;
  /** File name (no folders), NFC-normalized. */
  name: string;
  /**
   * Metadata identity. Copies of a file share it — and with it their tags, so
   * tagging one copy tags them all.
   */
  metaKey: string;
  /** The user's own tags on the file. */
  tags: string[];
}

export interface AutoTagLibrary {
  files: AutoTagFile[];
  /** Alive files in scope; larger than `files.length` when the sample was cut. */
  total: number;
  /** Names of the user's own tags in scope. */
  existingTags: string[];
}

/** Files (by workspace) that should receive the same tags. */
export interface AutoTagAssignment {
  workspaceId: string;
  fileIds: number[];
  tags: string[];
}

export interface AutoTagApplyResult {
  /** Files that gained at least one tag. */
  files: number;
  /** (file, tag) pairs attached. */
  added: number;
  /**
   * Handle for taking exactly these pairs back — used to roll an apply back
   * when a later call of it fails. Null when nothing was added.
   */
  undoId: string | null;
}
