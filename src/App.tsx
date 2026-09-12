// Routing. List / detail / settings.
import { createHashRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import Home from "@/routes/Home";
import MediaDetail from "@/routes/MediaDetail";
import Discover from "@/routes/Discover";
import Player from "@/routes/Player";
import History from "@/routes/History";
import Duplicates from "@/routes/Duplicates";
import Tags from "@/routes/Tags";
import Settings from "@/routes/Settings";
import { WorkspaceRail } from "@/components/WorkspaceRail";
import { AudioPlayerProvider } from "@/audio/AudioPlayerProvider";
import { AudioPlayerBar } from "@/audio/AudioPlayerBar";
import { useContentZoom } from "@/hooks/useContentZoom";
import { useSelectAllGuard } from "@/hooks/useSelectAllGuard";
import { useUpdateNotifier } from "@/hooks/useUpdateNotifier";

// In a webview, a hash router is more stable than a file-path-style history.
// /file/:id, /play and /settings are child routes of Home so a modal overlays on top while the list stays mounted
// (the player also inherits the list order through MediaNavContext).
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
      { path: "tags", element: <Tags /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

export default function App() {
  useContentZoom();
  useSelectAllGuard();
  useUpdateNotifier();
  return (
    <div className="flex h-full">
      <WorkspaceRail />
      {/* The provider and its single <audio> element sit OUTSIDE RouterProvider, so
          navigation never unmounts them and playback continues across route changes.
          Moving it inside a route would break that guarantee. */}
      <AudioPlayerProvider>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <RouterProvider router={router} />
          </div>
          <AudioPlayerBar />
        </div>
      </AudioPlayerProvider>
    </div>
  );
}
