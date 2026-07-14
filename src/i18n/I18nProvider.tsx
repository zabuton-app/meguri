// Language context. Same approach as ThemeProvider: localStorage persistence + runtime switching.
// Translations are retrieved via t("key", { params }) and support {name}-style interpolation.
import {
  createContext,
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

const CATALOGS: Record<Lang, Record<TranslationKey, string>> = {
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

/** Determine the default language from saved preference, otherwise use English. */
function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored && LANGUAGES.some((l) => l.id === stored)) return stored as Lang;
  } catch {
    // ignore
  }
  return "en";
}

/** Replace {name} with values from params. */
function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in params ? String(params[k]) : `{${k}}`,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  // Sync <html lang> + save the LS mirror.
  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LS_KEY, lang);
    } catch {
      // ignore
    }
  }, [lang]);

  const value = useMemo<I18nCtx>(() => {
    const catalog = CATALOGS[lang];
    const t: TFunc = (key, params) =>
      interpolate(catalog[key] ?? ja[key] ?? key, params);
    return { lang, setLang: setLangState, t };
  }, [lang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
