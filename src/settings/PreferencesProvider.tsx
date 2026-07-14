// User preferences (non-theme/non-language) persisted to localStorage, same approach as
// ThemeProvider / I18nProvider. Currently holds the scene-thumbnail count; add new prefs here.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_KEYBINDING_PRESET,
  isKeybindingPreset,
  type KeybindingPreset,
} from "@/settings/keybindings";

const LS_KEY = "meguri.prefs";

export const DEFAULT_SCENE_COUNT = 12;
export const SCENE_COUNT_MIN = 1;
export const SCENE_COUNT_MAX = 48;
// Choices offered in the settings UI.
export const SCENE_COUNT_OPTIONS = [4, 6, 8, 12, 16, 20, 24, 32] as const;

interface Prefs {
  sceneCount: number;
  keybindingPreset: KeybindingPreset;
}

const DEFAULTS: Prefs = {
  sceneCount: DEFAULT_SCENE_COUNT,
  keybindingPreset: DEFAULT_KEYBINDING_PRESET,
};

function clampSceneCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SCENE_COUNT;
  return Math.min(SCENE_COUNT_MAX, Math.max(SCENE_COUNT_MIN, Math.round(n)));
}

/** Load saved prefs, falling back to defaults for missing/invalid fields. */
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      return {
        sceneCount:
          typeof parsed.sceneCount === "number"
            ? clampSceneCount(parsed.sceneCount)
            : DEFAULT_SCENE_COUNT,
        keybindingPreset: isKeybindingPreset(parsed.keybindingPreset)
          ? parsed.keybindingPreset
          : DEFAULT_KEYBINDING_PRESET,
      };
    }
  } catch {
    // ignore
  }
  return DEFAULTS;
}

interface PrefsCtx extends Prefs {
  setSceneCount: (n: number) => void;
  setKeybindingPreset: (p: KeybindingPreset) => void;
}

const Ctx = createContext<PrefsCtx | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  const value = useMemo<PrefsCtx>(
    () => ({
      ...prefs,
      setSceneCount: (n) =>
        setPrefs((p) => ({ ...p, sceneCount: clampSceneCount(n) })),
      setKeybindingPreset: (kp) =>
        setPrefs((p) => ({ ...p, keybindingPreset: kp })),
    }),
    [prefs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PrefsCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
