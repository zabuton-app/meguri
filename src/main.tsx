import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/themes/ThemeProvider";
import { I18nProvider } from "@/i18n/I18nProvider";
import { PreferencesProvider } from "@/settings/PreferencesProvider";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import log from "@/lib/logger";
import App from "@/App";
import { Toaster } from "sonner";
import "@/styles.css";

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
const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <I18nProvider>
            <PreferencesProvider>
              <ConfirmProvider>
                <App />
                <Toaster
                  position="top-right"
                  visibleToasts={4}
                  gap={8}
                  closeButton
                  toastOptions={{
                    classNames: {
                      toast: "meguri-toast",
                      title: "text-bright-fg",
                      description: "meguri-toast-description",
                    },
                  }}
                />
              </ConfirmProvider>
            </PreferencesProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
