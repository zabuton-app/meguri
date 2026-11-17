// Starts the renderer. Meguri's entry (src/main.tsx) calls it with no
// options; an app built on Meguri calls it from its own entry with its own
// settings sections and routes (#475), the renderer-side counterpart of
// startApp() in electron/app.ts.
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RouteObject } from "react-router";
import { ThemeProvider } from "@/themes/ThemeProvider";
import { I18nProvider } from "@/i18n/I18nProvider";
import { PreferencesProvider } from "@/settings/PreferencesProvider";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { TourProvider } from "@/tour/TourProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import log from "@/lib/logger";
import App from "@/App";
import { createAppRouter, type AppRouter } from "@/appRouter";
import {
  ExtraSettingsSectionsProvider,
  type SettingsSection,
} from "@/settings/extraSections";
import { logoImagesQuery } from "@/hooks/useLogo";
import { smartCollectionsQuery } from "@/hooks/useSmartCollections";
import { createRendererQueryClient } from "@/lib/queryClient";
import { Toaster } from "sonner";
import "@/styles.css";

export type { SettingsSection } from "@/settings/extraSections";

export interface RenderAppOptions {
  /** Settings tabs shown after Meguri's own, in this order. */
  settingsSections?: readonly SettingsSection[];
  /**
   * Routes added under the app shell next to Meguri's (/settings, /tags…).
   * Like those, they are children of the list, so an element that should
   * float over it renders as a modal.
   */
  routes?: readonly RouteObject[];
}

export function renderApp(options: RenderAppOptions = {}): void {
  // Catch errors that ErrorBoundary can't: synchronous errors outside the React
  // tree and unhandled promise rejections from event handlers / async callbacks.
  // Both get forwarded to the main log file via electron-log/renderer.
  window.addEventListener("error", (e) => {
    log.error("window error:", e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    log.error("unhandledrejection:", e.reason);
  });

  // Mutations patch or invalidate only the queries they affect (see
  // src/lib/queryCache.ts). Avoid a global MutationCache.onSuccess: it refetched
  // every active query on each toggle and doubled work with per-mutation handlers.
  // A failed mutation gets a generic toast from useMutationErrorNotifier; one
  // that shows its own error sets `meta: { reportsOwnError: true }`.
  const queryClient = createRendererQueryClient();
  // The rail's logo comes from main; ask before the first render so it is
  // there as early as it can be.
  void queryClient.prefetchQuery(logoImagesQuery);

  const router = createAppRouter(options.routes);
  const settingsSections = options.settingsSections ?? [];

  const root = ReactDOM.createRoot(document.getElementById("root")!);
  // The saved searches come from main: the list opens on the default one
  // (initialFilter), so they are loaded before the first render. Asked once:
  // when that fails, the window opens anyway, and Home asks again and applies
  // the default when it arrives.
  void queryClient
    .prefetchQuery({ ...smartCollectionsQuery, retry: false })
    .finally(() => render(root, queryClient, router, settingsSections));
}

function render(
  root: ReactDOM.Root,
  queryClient: QueryClient,
  router: AppRouter,
  settingsSections: readonly SettingsSection[],
): void {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <I18nProvider>
              <PreferencesProvider>
                <TourProvider>
                  <ConfirmProvider>
                    <ExtraSettingsSectionsProvider value={settingsSections}>
                      <App router={router} />
                    </ExtraSettingsSectionsProvider>
                    <Toaster
                      position="top-right"
                      visibleToasts={4}
                      gap={8}
                      closeButton
                      toastOptions={{
                        classNames: {
                          // select-text: error toasts render raw error.message.
                          // Sonner captures the pointer for swipe-to-dismiss, so
                          // dragging across a toast selects nothing; double- and
                          // triple-click still do.
                          toast: "meguri-toast select-text",
                          title: "text-bright-fg",
                          description: "meguri-toast-description",
                        },
                      }}
                    />
                  </ConfirmProvider>
                </TourProvider>
              </PreferencesProvider>
            </I18nProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
