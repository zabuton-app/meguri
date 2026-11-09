// Mirror the current appearance onto <html data-appearance="light|dark"> so
// that user stylesheets (custom.css, CSS themes) can write light and dark
// variants without listing every scheme id. Kept out of the series-shared
// ThemeProvider: it exists for Meguri's custom CSS only.
import { useEffect } from "react";
import { useTheme } from "@/themes/ThemeProvider";

export function useAppearanceAttribute(): void {
  const { mode } = useTheme();
  useEffect(() => {
    document.documentElement.setAttribute("data-appearance", mode);
  }, [mode]);
}
