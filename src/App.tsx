// The app shell: the workspace rail, the router (src/appRouter.tsx) and what
// sits beside it.
import { useEffect } from "react";
import { RouterProvider } from "react-router/dom";
import { WorkspaceRail } from "@/components/WorkspaceRail";
import { AudioPlayerProvider } from "@/audio/AudioPlayerProvider";
import { AudioPlayerBar } from "@/audio/AudioPlayerBar";
import { StatusBar } from "@/components/StatusBar";
import { LibraryMergeModal } from "@/components/LibraryMergeModal";
import { CrashReportNotice } from "@/components/CrashReportNotice";
import { useAppearanceAttribute } from "@/hooks/useAppearanceAttribute";
import { useContentZoom } from "@/hooks/useContentZoom";
import { useCssThemeStyle } from "@/hooks/useCssThemes";
import { useCustomCssStyle } from "@/hooks/useCustomCss";
import { useSelectAllGuard } from "@/hooks/useSelectAllGuard";
import { useUpdateNotifier } from "@/hooks/useUpdateNotifier";
import { useMutationErrorNotifier } from "@/hooks/useMutationErrorNotifier";
import { useLibraryRestoreNotifier } from "@/hooks/useLibraryRestoreNotifier";
import { useConfigProblemNotifier } from "@/hooks/useConfigProblemNotifier";
import type { AppRouter } from "@/appRouter";
import { markStartup } from "@/lib/startupTiming";

export default function App({ router }: { router: AppRouter }) {
  useContentZoom();
  useSelectAllGuard();
  useUpdateNotifier();
  useMutationErrorNotifier();
  useLibraryRestoreNotifier();
  useConfigProblemNotifier();
  useAppearanceAttribute();
  useCssThemeStyle();
  useCustomCssStyle();
  useEffect(() => markStartup("first render"), []);
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
          {/* Player bar sits on top of the status bar: the status bar is always
              the lowest strip of the window, whatever else is showing. */}
          <AudioPlayerBar />
          <StatusBar />
        </div>
      </AudioPlayerProvider>
      <LibraryMergeModal />
      <CrashReportNotice />
    </div>
  );
}
