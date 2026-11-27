// The app shell: the title bar across the top (with the logo and the screen's
// header), and below it the workspace rail, the router (src/appRouter.tsx)
// and what sits beside it. The bar and the rail are one frame in the chrome
// color (each paints it); the content is a panel set into it.
import { useEffect, useState } from "react";
import { RouterProvider } from "react-router/dom";
import { TitleBar } from "@/components/TitleBar";
import { TitleBarSlot } from "@/components/titleBarSlotContext";
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
  // The title bar's slot, where the screen's header renders (Home's).
  const [titleBarSlot, setTitleBarSlot] = useState<HTMLElement | null>(null);
  return (
    <TitleBarSlot.Provider value={titleBarSlot}>
      <div className="flex h-full flex-col">
        <TitleBar slotRef={setTitleBarSlot} />
        <div className="flex min-h-0 flex-1">
          <WorkspaceRail />
          {/* The provider and its single <audio> element sit OUTSIDE RouterProvider, so
          navigation never unmounts them and playback continues across route changes.
          Moving it inside a route would break that guarantee. */}
          <AudioPlayerProvider>
            {/* The frame's strip right of and below the panel. The panel
                itself is left unpainted: a theme can show the page's
                background (body's) through the list. Its shadow paints the
                frame into the corners its rounding leaves, and this box
                clips the shadow there, off the bar and the rail. */}
            <div className="flex min-w-0 flex-1 overflow-hidden border-b-6 border-r-6 border-chrome">
              <div
                data-slot="content-panel"
                className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-border shadow-[0_0_0_16px_var(--color-chrome)]"
              >
                <div className="min-h-0 flex-1">
                  <RouterProvider router={router} />
                </div>
                {/* Player bar sits on top of the status bar: the status bar is always
                the lowest strip of the window, whatever else is showing. */}
                <AudioPlayerBar />
                <StatusBar />
              </div>
            </div>
          </AudioPlayerProvider>
        </div>
        <LibraryMergeModal />
        <CrashReportNotice />
      </div>
    </TitleBarSlot.Provider>
  );
}
