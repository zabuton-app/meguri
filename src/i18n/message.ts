// A catalog entry: one string, or one per plural category of `{count}` (#285).
// ja.ts, the source of the keys, has no plural forms; a locale that needs them
// gives an object instead, with at least `other`.
import type { TranslationKey } from "./locales/ja";

export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & {
  other: string;
};
export type Message = string | PluralMessage;
export type Catalog = Record<TranslationKey, Message>;

/** The string for these params: by the plural category of `count` when the
 *  entry has forms (a count that is not a number takes `other`). */
export function pickMessage(
  message: Message,
  rules: Intl.PluralRules,
  count: unknown,
): string {
  if (typeof message === "string") return message;
  if (typeof count !== "number") return message.other;
  return message[rules.select(count)] ?? message.other;
}
