// CSS theme files (<userData>/themes/*.css), shared app-wide through the
// react-query cache like useCustomCss: main owns the folder, its watcher and
// the pick. useCssThemeStyle (mounted once in App) applies the picked theme;
// the Settings theme grid lists and picks through useCssThemes.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, events, type CssThemesState } from "@/ipc/client";
import { CUSTOM_CSS_STYLE_ID } from "@/hooks/useCustomCss";

const QUERY_KEY = ["cssThemes"] as const;
const STYLE_ID = "meguri-css-theme";

function useCssThemesState(): CssThemesState | undefined {
  // Changes arrive through select and the css-themes:changed event, both of
  // which write the cache, so it is only refetched after a refused pick.
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.cssThemesGet(),
    staleTime: Infinity,
  }).data;
}

export function useCssThemes(): {
  state: CssThemesState | undefined;
  select: (file: string | null) => void;
  pending: boolean;
} {
  const qc = useQueryClient();
  const data = useCssThemesState();
  const { mutate, isPending } = useMutation({
    mutationFn: (file: string | null) => api.cssThemeSelect(file),
    scope: { id: "cssThemes" },
    onSuccess: (next) => qc.setQueryData(QUERY_KEY, next),
    // A file removed just before it was picked: main refuses it, so read the
    // folder again rather than leave the list waiting for the watch.
    onError: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
  return { state: data, select: mutate, pending: isPending };
}

/** Keep the theme's <style> element in step with the pick. Mount once. */
export function useCssThemeStyle(): void {
  const qc = useQueryClient();
  const css = useCssThemesState()?.css ?? "";

  useEffect(() => {
    return events.onCssThemesChanged((next) =>
      qc.setQueryData(QUERY_KEY, next),
    );
  }, [qc]);

  useEffect(() => {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      // After the theme variables ThemeProvider injects at import time, and
      // before custom.css whichever of the two is created first, so that
      // personal tweaks win over the theme at equal specificity.
      el = document.createElement("style");
      el.id = STYLE_ID;
      const custom = document.getElementById(CUSTOM_CSS_STYLE_ID);
      if (custom) custom.before(el);
      else document.head.appendChild(el);
    }
    // textContent: the file is only ever parsed as CSS, never as markup.
    el.textContent = css;
  }, [css]);
}
