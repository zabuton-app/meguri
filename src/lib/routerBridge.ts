// Navigation for the few components that live outside RouterProvider (the
// audio player bar in App.tsx). Writing `window.location.hash` also works with a
// hash router, but it bypasses the router: no navigation state, no blockers,
// and nothing the router could later batch or intercept. App registers the data
// router's navigate here once it exists; until then (and in tests that render
// without App) the hash write is the fallback.
type Navigate = (to: string) => void;

let navigate: Navigate | null = null;

export function registerRouterNavigate(fn: Navigate | null): void {
  navigate = fn;
}

export function navigateOutsideRouter(to: string): void {
  if (navigate) navigate(to);
  else window.location.hash = to;
}
