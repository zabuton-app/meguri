// App logo variant, shared app-wide through the react-query cache.
//
// The value lives in main's config.json (the tray and window icons need it
// before any renderer exists), so unlike other UI preferences it is fetched
// and stored over IPC instead of PreferencesProvider/localStorage. Reading it
// through a query keys every consumer (Settings picker, workspace rail logo)
// to the same cache entry, so a change propagates everywhere at once.
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import type { LogoId } from "@shared/ipc/schema";
import logoDarkPng from "../../logo/app-256.png";
import logoLightPng from "../../logo/light/app-256.png";
import logoEnsoPng from "../../logo/enso/app-256.png";

/** Bundled preview/in-app bitmap per logo variant. */
export const LOGO_SRC: Record<LogoId, string> = {
  dark: logoDarkPng,
  light: logoLightPng,
  enso: logoEnsoPng,
};

const LOGO_QUERY_KEY = ["logo"] as const;

export function useLogo(): {
  logo: LogoId;
  setLogo: (next: LogoId) => void;
} {
  const qc = useQueryClient();
  // The logo only changes through setLogo below, so the cached value never
  // goes stale on its own — no refetching.
  const { data } = useQuery({
    queryKey: LOGO_QUERY_KEY,
    queryFn: () => api.logoGet(),
    staleTime: Infinity,
  });
  // Optimistic; settle on main's echoed value, roll back if the IPC fails.
  const { mutate } = useMutation({
    mutationFn: (next: LogoId) => api.logoSet(next),
    // Serialize picks so a slow earlier IPC cannot settle after a later one.
    scope: { id: "logo" },
    onMutate: async (next) => {
      // The in-flight initial logoGet() would otherwise overwrite the
      // optimistic value when it resolves.
      await qc.cancelQueries({ queryKey: LOGO_QUERY_KEY });
      const prev = qc.getQueryData<LogoId>(LOGO_QUERY_KEY);
      qc.setQueryData(LOGO_QUERY_KEY, next);
      return { prev };
    },
    onSuccess: (applied) => qc.setQueryData(LOGO_QUERY_KEY, applied),
    onError: (_e, _next, ctx) => {
      // setQueryData(key, undefined) is a no-op, so when the initial load
      // hadn't resolved yet there is no value to roll back to — refetch.
      if (ctx?.prev !== undefined) qc.setQueryData(LOGO_QUERY_KEY, ctx.prev);
      else void qc.invalidateQueries({ queryKey: LOGO_QUERY_KEY });
    },
  });
  const logo = data ?? "dark";
  const setLogo = useCallback(
    (next: LogoId) => {
      // Re-picking the active variant would be a pointless IPC round-trip.
      if (next !== qc.getQueryData<LogoId>(LOGO_QUERY_KEY)) mutate(next);
    },
    [qc, mutate],
  );
  return { logo, setLogo };
}
