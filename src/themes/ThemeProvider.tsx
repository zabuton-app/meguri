// Theme application and context. Injects the CSS-variable blocks for all schemes into a single <style>,
// and changes the whole UI consistently by switching <html data-theme> (runtime application approach).
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { deriveTokens, schemeToCssVars } from "./derive";
import { DEFAULT_THEME, SCHEMES } from "./schemes";

const LS_KEY = "meguri.theme";
const LS_BG_KEY = "meguri.theme.bg";

export type Appearance = "light" | "dark";

export interface ThemeFamily {
  id: string;
  name: string;
  dark?: (typeof SCHEMES)[number];
  light?: (typeof SCHEMES)[number];
}

/** Group by family (preserving definition order). */
function buildFamilies(): ThemeFamily[] {
  const map = new Map<string, ThemeFamily>();
  for (const s of SCHEMES) {
    let fam = map.get(s.family);
    if (!fam) {
      fam = { id: s.family, name: s.familyName };
      map.set(s.family, fam);
    }
    fam[s.appearance] = s;
  }
  return [...map.values()];
}

const FAMILIES = buildFamilies();

interface ThemeCtx {
  /** Currently applied variant id. */
  theme: string;
  setTheme: (id: string) => void;
  schemes: typeof SCHEMES;
  families: ThemeFamily[];
  /** Current appearance. */
  mode: Appearance;
  /** Current family id. */
  familyId: string;
  /** Switch appearance (applies the same family's counterpart if available). */
  setMode: (mode: Appearance) => void;
  /** Select a family (applies the variant for the current appearance, or the paired variant if absent). */
  setFamily: (familyId: string) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

const defaultScheme = SCHEMES.find((s) => s.id === DEFAULT_THEME) ?? SCHEMES[0];

/**
 * Generate the CSS for all schemes once (only changes when a theme is added).
 *
 * `html[data-theme]` rather than `[data-theme]`: the extra specificity makes these blocks
 * independent of where this <style> lands relative to styles.css in the document. The `:root`
 * block is the safety net for a data-theme value that matches no scheme (a renamed id left in
 * localStorage), which would otherwise leave every --c-* undefined.
 */
function buildStyleSheet(): string {
  return [
    `:root {\n${schemeToCssVars(defaultScheme)}\n}`,
    ...SCHEMES.map(
      (s) => `html[data-theme="${s.id}"] {\n${schemeToCssVars(s)}\n}`,
    ),
  ].join("\n\n");
}

/**
 * Inject at import time, not from an effect: public/theme-boot.js sets data-theme before the
 * first paint, so the matching variables have to exist by then as well. main.tsx imports this
 * module before it calls createRoot().render().
 */
function injectStyleSheet(): void {
  if (typeof document === "undefined") return;
  const id = "meguri-theme-vars";
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = buildStyleSheet();
}

injectStyleSheet();

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<string>(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LS_KEY);
    } catch {
      // ignore
    }
    // A stale id (renamed or removed scheme) would match no [data-theme] block at all.
    return SCHEMES.find((s) => s.id === stored)?.id ?? DEFAULT_THEME;
  });

  // Apply data-theme + save the LS mirror.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    const scheme = SCHEMES.find((s) => s.id === theme);
    const bg = scheme && deriveTokens(scheme).bg;
    if (bg) document.documentElement.style.backgroundColor = bg;
    try {
      localStorage.setItem(LS_KEY, theme);
      // Read back by public/theme-boot.js, which runs before the bundle and therefore before
      // any palette is available (see injectStyleSheet).
      if (bg) localStorage.setItem(LS_BG_KEY, bg);
    } catch {
      // ignore
    }
    // TODO(Phase 1): also persist to SQLite settings via a Tauri command.
  }, [theme]);

  const setTheme = (id: string) => {
    if (SCHEMES.some((s) => s.id === id)) setThemeState(id);
  };

  const current = SCHEMES.find((s) => s.id === theme) ?? SCHEMES[0];
  const mode: Appearance = current.appearance;
  const familyId = current.family;

  const setMode = (m: Appearance) => {
    const fam = FAMILIES.find((f) => f.id === familyId);
    const next = fam?.[m] ?? fam?.dark ?? fam?.light;
    if (next) setThemeState(next.id);
  };

  const setFamily = (fid: string) => {
    const fam = FAMILIES.find((f) => f.id === fid);
    const next = fam?.[mode] ?? fam?.dark ?? fam?.light;
    if (next) setThemeState(next.id);
  };

  const value = useMemo<ThemeCtx>(
    () => ({
      theme,
      setTheme,
      schemes: SCHEMES,
      families: FAMILIES,
      mode,
      familyId,
      setMode,
      setFamily,
    }),
    // setMode/setFamily are re-created each render; listing them would defeat the
    // memo. They close over `mode`/`familyId`, which are in the deps, so the value
    // stays correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, mode, familyId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
