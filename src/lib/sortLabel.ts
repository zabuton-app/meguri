// Sort-key → translated label. Lives in lib/ because both the filter bar and the
// condition derivation need it, and neither should reach into a route's utils.
import type { TFunc } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";

export const SORT_KEYS: Record<string, TranslationKey> = {
  added: "sort.added",
  manual: "sort.manual",
  name: "sort.name",
  rating: "sort.rating",
  captured: "sort.captured",
  btime: "filter.btime",
  accessed: "sort.accessed",
  hash: "sort.hash",
};

export function sortLabel(t: TFunc, s: string): string {
  const key = SORT_KEYS[s];
  return t("filter.sortLabel", { label: key ? t(key) : s });
}
