// Language context. Same approach as ThemeProvider: localStorage persistence + runtime switching.
// Translations are retrieved via t("key", { params }) and support {name}-style interpolation.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ja, type TranslationKey } from "./locales/ja";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";
import { ko } from "./locales/ko";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { appName } from "@/lib/appName";
import { pickMessage, type Catalog } from "./message";

const LS_KEY = "meguri.lang";

export type Lang = "ja" | "en" | "zh-CN" | "ko" | "es" | "fr";

export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "zh-CN", label: "简体中文" },
  { id: "ko", label: "한국어" },
  { id: "es", label: "Español" },
  { id: "fr", label: "Français" },
];

const CATALOGS: Record<Lang, Catalog> = {
  ja,
  en,
  "zh-CN": zhCN,
  ko,
  es,
  fr,
};

export type TParams = Record<string, string | number>;
export type TFunc = (key: TranslationKey, params?: TParams) => string;

interface I18nCtx {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunc;
}

const Ctx = createContext<I18nCtx | null>(null);

/**
 * The language one BCP 47 tag maps to, or undefined when Meguri has no translation for it.
 * An exact match wins (`zh-CN`), then the primary subtag (`es-MX` -> `es`). Traditional
 * Chinese tags (`zh-TW`, `zh-HK`, `zh-Hant`) stay English: the app ships Simplified only.
 */
function matchLang(tag: string | undefined): Lang | undefined {
  if (!tag) return undefined;
  const lower = tag.trim().toLowerCase();
  if (!lower) return undefined;
  const exact = LANGUAGES.find((l) => l.id.toLowerCase() === lower);
  if (exact) return exact.id;
  if (
    lower === "zh-tw" ||
    lower === "zh-hk" ||
    lower === "zh-mo" ||
    lower.startsWith("zh-hant")
  ) {
    return undefined;
  }
  const base = lower.split("-")[0];
  return base
    ? LANGUAGES.find((l) => l.id.toLowerCase() === base)?.id
    : undefined;
}

/** Determine the default language: the saved choice, then the OS language, then English. */
function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored && LANGUAGES.some((l) => l.id === stored)) return stored as Lang;
  } catch {
    // ignore
  }
  // Read the OS language but do not store it (#505): a user who changes the OS language
  // gets the new one until they pick a language in Settings, which does persist.
  const languages = navigator.languages;
  for (const tag of languages?.length ? languages : [navigator.language]) {
    const match = matchLang(tag);
    if (match) return match;
  }
  return "en";
}

/** Replace {name} with values from params, numbers written for the app's
 *  language rather than the OS's (#285); {app} is always the app's name. */
function interpolate(
  template: string,
  numbers: Intl.NumberFormat,
  params?: TParams,
): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (params && k in params) {
      const value = params[k];
      return typeof value === "number" ? numbers.format(value) : value;
    }
    return k === "app" ? appName() : `{${k}}`;
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  // Only a language the user picked is stored, so the OS language is read again on the
  // next launch until then (#505). Keep <html lang> in sync with the active catalog.
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LS_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nCtx>(() => {
    const catalog = CATALOGS[lang];
    const rules = new Intl.PluralRules(lang);
    const numbers = new Intl.NumberFormat(lang);
    const t: TFunc = (key, params) =>
      interpolate(
        pickMessage(catalog[key] ?? ja[key] ?? key, rules, params?.count),
        numbers,
        params,
      );
    return { lang, setLang, t };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
