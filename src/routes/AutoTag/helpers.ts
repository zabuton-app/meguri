// Non-component helpers shared by the auto-tagging tabs.
import type { TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import {
  MAX_AUTO_TAG_ALIASES,
  MAX_AUTO_TAG_KEYWORDS,
  cleanTagName,
  isUsableTagName,
  type BuiltinRuleId,
  type KeywordEntry,
  type TagRule,
} from "@shared/autoTag";
import type { Candidate } from "@shared/autoTagAnalysis";

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

/** Rows drawn per list; past this a note says how many were left out. */
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

/** A candidate is settled once every file it names already carries the tag. */
export function isApplied(
  c: Candidate,
  fileTags: readonly Set<string>[],
): boolean {
  for (const index of c.files.keys()) {
    if (!fileTags[index].has(c.key)) return false;
  }
  return true;
}
