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
import { schemeToCssVars } from "./base16";
import { DEFAULT_THEME, SCHEMES } from "./schemes";

const LS_KEY = "meguri.theme";

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

/** Generate the CSS for all schemes once (only changes when a theme is added). */
function buildStyleSheet(): string {
  return SCHEMES.map(
    (s) => `[data-theme="${s.id}"] {\n${schemeToCssVars(s)}\n}`,
  ).join("\n\n");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_KEY) || DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  });

  // Inject the CSS sheet only once.
  useEffect(() => {
    const id = "meguri-theme-vars";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = buildStyleSheet();
  }, []);

  // Apply data-theme + save the LS mirror.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(LS_KEY, theme);
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
