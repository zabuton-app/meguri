// User stylesheet (<userData>/custom.css), shared app-wide through the
// react-query cache like useLogo: main owns the file, its watcher and the
// on/off switch, so the state is fetched over IPC rather than kept in
// localStorage. useCustomCssStyle (mounted once in App) applies it; the
// settings section reads and changes it through useCustomCss.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, events, type CustomCssState } from "@/ipc/client";

const QUERY_KEY = ["customCss"] as const;
/** Also read by useCssThemes, which places the theme's <style> before it. */
export const CUSTOM_CSS_STYLE_ID = "meguri-custom-css";

function useCustomCssState(): CustomCssState | undefined {
  // Changes arrive through setEnabled and the custom-css:changed event, both
  // of which write the cache, so it never needs refetching.
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.customCssGet(),
    staleTime: Infinity,
  }).data;
}

export function useCustomCss(): {
  state: CustomCssState | undefined;
  setEnabled: (enabled: boolean) => void;
  pending: boolean;
} {
  const qc = useQueryClient();
  const data = useCustomCssState();
  const { mutate, isPending } = useMutation({
    mutationFn: (enabled: boolean) => api.customCssSetEnabled(enabled),
    scope: { id: "customCss" },
    onSuccess: (next) => qc.setQueryData(QUERY_KEY, next),
  });
  return { state: data, setEnabled: mutate, pending: isPending };
}

/** Keep the <style> element in step with the stylesheet. Mount once. */
export function useCustomCssStyle(): void {
  const qc = useQueryClient();
  const state = useCustomCssState();
  const css = state?.enabled ? (state.css ?? "") : "";

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void events
      .onCustomCssChanged(({ css: next }) => {
        qc.setQueryData<CustomCssState>(QUERY_KEY, (prev) =>
          // An event that lands after the switch went off must not bring
          // the stylesheet back.
          prev?.enabled ? { ...prev, css: next } : prev,
        );
      })
      .then((un) => {
        if (active) unlisten = un;
        else un();
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [qc]);

  useEffect(() => {
    let el = document.getElementById(
      CUSTOM_CSS_STYLE_ID,
    ) as HTMLStyleElement | null;
    if (!el) {
      // Appended last, after the theme variables ThemeProvider injects at
      // import time, so that equal-specificity rules here win.
      el = document.createElement("style");
      el.id = CUSTOM_CSS_STYLE_ID;
      document.head.appendChild(el);
    }
    // textContent: the file is only ever parsed as CSS, never as markup.
    el.textContent = css;
  }, [css]);
}
