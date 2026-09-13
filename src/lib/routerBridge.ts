// Navigation for the few components that live outside RouterProvider (the
// audio player bar in App.tsx). Writing `window.location.hash` also works with a
// hash router, but it bypasses the router: no navigation state, no blockers,
// and nothing the router could later batch or intercept. App registers the data
// router's navigate here once it exists; until then (and in tests that render
// without App) the hash write is the fallback.
export interface OutsideRouterNavigateOpts {
  replace?: boolean;
  state?: unknown;
}

type Navigate = (to: string, opts?: OutsideRouterNavigateOpts) => void;

let navigate: Navigate | null = null;

export function registerRouterNavigate(fn: Navigate | null): void {
  navigate = fn;
}

export function navigateOutsideRouter(
  to: string,
  opts?: OutsideRouterNavigateOpts,
): void {
  if (navigate) {
    navigate(to, opts);
    return;
  }
  if (opts?.replace) {
    const url = new URL(window.location.href);
    url.hash = to;
    window.location.replace(url.toString());
    return;
  }
  window.location.hash = to;
}
