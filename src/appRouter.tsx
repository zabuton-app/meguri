// Routing. List / detail / settings.
import { createHashRouter, type RouteObject } from "react-router";
import Home from "@/routes/Home";
import MediaDetail from "@/routes/MediaDetail";
import Discover from "@/routes/Discover";
import Player from "@/routes/Player";
import History from "@/routes/History";
import Duplicates from "@/routes/Duplicates";
import Missing from "@/routes/Missing";
import Tags from "@/routes/Tags";
import AutoTag from "@/routes/AutoTag";
import Settings from "@/routes/Settings";
import { registerRouterNavigate } from "@/lib/routerBridge";

// In a webview, a hash router is more stable than a file-path-style history.
// /file/:id, /play and /settings are child routes of Home so a modal overlays on top while the list stays mounted
// (the player also inherits the list order through MediaNavContext).
// `extraRoutes` are an app's own routes (renderApp's `routes`), added after
// Meguri's under the same shell.
export function createAppRouter(extraRoutes: readonly RouteObject[] = []) {
  const router = createHashRouter([
    {
      path: "/",
      element: <Home />,
      children: [
        { path: "file/:id", element: <MediaDetail /> },
        { path: "discover", element: <Discover /> },
        { path: "play", element: <Player /> },
        { path: "history", element: <History /> },
        { path: "duplicates", element: <Duplicates /> },
        { path: "missing", element: <Missing /> },
        { path: "tags", element: <Tags /> },
        { path: "auto-tag", element: <AutoTag /> },
        { path: "settings", element: <Settings /> },
        ...extraRoutes,
      ],
    },
  ]);
  // Lets the player bar (mounted beside the router in App.tsx) navigate through the
  // router rather than by rewriting the hash behind its back.
  registerRouterNavigate((to, opts) => void router.navigate(to, opts));
  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;
