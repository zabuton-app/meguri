// Regression test: every locale must stay in sync with the ja catalog (the source of truth)
// in both its key set and its {param} interpolation placeholders.
import { describe, expect, it } from "vitest";
import { ja, type TranslationKey } from "@/i18n/locales/ja";
import { en } from "@/i18n/locales/en";
import { zhCN } from "@/i18n/locales/zh-CN";
import { ko } from "@/i18n/locales/ko";
import { es } from "@/i18n/locales/es";
import { fr } from "@/i18n/locales/fr";
import type { Catalog, Message } from "@/i18n/message";

const catalogs: Record<string, Catalog> = {
  en,
  "zh-CN": zhCN,
  ko,
  es,
  fr,
};
const jaKeys = Object.keys(ja).sort();

/**
 * The sorted set of {placeholder} tokens in a translation string. {app} is
 * left out: t() always fills it in, so a locale may name the app where ja
 * does not.
 */
function tokens(s: string): string[] {
  return (s.match(/\{(\w+)\}/g) ?? []).filter((t) => t !== "{app}").sort();
}

/** Every string of an entry: the entry itself, or each of its plural forms. */
function forms(message: Message): string[] {
  return typeof message === "string" ? [message] : Object.values(message);
}

// The name comes from the main process (startApp()), so an app started with
// another name must not show this one: strings say {app} instead.
it.each(Object.entries({ ja, ...catalogs }))(
  "%s does not spell out the app's name",
  (_name, catalog) => {
    const named = Object.keys(catalog).filter((k) =>
      forms(catalog[k as TranslationKey]).some((s) => s.includes("Meguri")),
    );
    expect(named).toEqual([]);
  },
);

describe.each(Object.entries(catalogs))("%s locale", (lang, catalog) => {
  it("has exactly the same keys as ja", () => {
    expect(Object.keys(catalog).sort()).toEqual(jaKeys);
  });

  it("preserves the {param} placeholders of every ja string", () => {
    const mismatched = jaKeys.filter((k) =>
      forms(catalog[k as TranslationKey]).some(
        (s) =>
          tokens(s).join(",") !== tokens(ja[k as TranslationKey]).join(","),
      ),
    );
    expect(mismatched).toEqual([]);
  });

  it("gives plural forms only to strings with a {count}, in the language's categories", () => {
    const categories = new Set<string>(
      new Intl.PluralRules(lang).resolvedOptions().pluralCategories,
    );
    const wrong = jaKeys.filter((k) => {
      const message = catalog[k as TranslationKey];
      if (typeof message === "string") return false;
      return (
        !ja[k as TranslationKey].includes("{count}") ||
        Object.keys(message).some((form) => !categories.has(form))
      );
    });
    expect(wrong).toEqual([]);
  });
});
