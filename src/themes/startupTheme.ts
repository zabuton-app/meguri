import { api } from "@/ipc/client";
import log from "@/lib/logger";
import { loadPrefs } from "@/settings/PreferencesProvider";
import { applyTheme, randomStartupTheme } from "@/themes/ThemeProvider";

export function startTheme(): {
  theme: string | undefined;
  ready: Promise<unknown>;
} {
  if (!loadPrefs().randomThemeOnStartup) {
    return { theme: undefined, ready: Promise.resolve() };
  }
  const theme = randomStartupTheme();
  applyTheme(theme);
  const ready = api.cssThemeSelect(null).catch((error: unknown) => {
    log.error("Failed to clear CSS theme on startup:", error);
  });
  return { theme, ready };
}
