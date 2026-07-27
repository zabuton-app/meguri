// Routing. List / detail / settings.
import { createHashRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import Home from "@/routes/Home";
import MediaDetail from "@/routes/MediaDetail";
import Discover from "@/routes/Discover";
import History from "@/routes/History";
import Duplicates from "@/routes/Duplicates";
import Settings from "@/routes/Settings";
import { WorkspaceRail } from "@/components/WorkspaceRail";
import { useContentZoom } from "@/hooks/useContentZoom";
import { useUpdateNotifier } from "@/hooks/useUpdateNotifier";

// In a webview, a hash router is more stable than a file-path-style history.
// /file/:id and /settings are child routes of Home so a modal overlays on top while the list stays mounted.
const router = createHashRouter([
  {
    path: "/",
    element: <Home />,
    children: [
      { path: "file/:id", element: <MediaDetail /> },
      { path: "discover", element: <Discover /> },
      { path: "history", element: <History /> },
      { path: "duplicates", element: <Duplicates /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

export default function App() {
  useContentZoom();
  useUpdateNotifier();
  return (
    <div className="flex h-full">
      <WorkspaceRail />
      <div className="min-w-0 flex-1">
        <RouterProvider router={router} />
      </div>
    </div>
  );
}
