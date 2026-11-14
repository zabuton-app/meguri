// Regression test: every locale must stay in sync with the ja catalog (the source of truth)
// in both its key set and its {param} interpolation placeholders.
import { describe, expect, it } from "vitest";
import { ja, type TranslationKey } from "@/i18n/locales/ja";
import { en } from "@/i18n/locales/en";
import { zhCN } from "@/i18n/locales/zh-CN";
import { ko } from "@/i18n/locales/ko";
import { es } from "@/i18n/locales/es";
import { fr } from "@/i18n/locales/fr";

const catalogs: Record<string, Record<TranslationKey, string>> = {
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

// The name comes from the main process (startApp()), so an app started with
// another name must not show this one: strings say {app} instead.
it.each(Object.entries({ ja, ...catalogs }))(
  "%s does not spell out the app's name",
  (_name, catalog) => {
    const named = Object.keys(catalog).filter((k) =>
      catalog[k as TranslationKey].includes("Meguri"),
    );
    expect(named).toEqual([]);
  },
);

describe.each(Object.entries(catalogs))("%s locale", (_name, catalog) => {
  it("has exactly the same keys as ja", () => {
    expect(Object.keys(catalog).sort()).toEqual(jaKeys);
  });

  it("preserves the {param} placeholders of every ja string", () => {
    const mismatched = jaKeys.filter(
      (k) =>
        tokens(catalog[k as TranslationKey]).join(",") !==
        tokens(ja[k as TranslationKey]).join(","),
    );
    expect(mismatched).toEqual([]);
  });
});
