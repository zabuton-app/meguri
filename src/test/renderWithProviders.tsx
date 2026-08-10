import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router";
import type { ReactElement, ReactNode } from "react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { PreferencesProvider } from "@/settings/PreferencesProvider";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { ThemeProvider } from "@/themes/ThemeProvider";

export interface RenderWithProvidersOptions extends Omit<
  RenderOptions,
  "wrapper"
> {
  /** Hash route without the leading `#`, e.g. `/` or `/file/1?ws=ws-test`. */
  route?: string;
  queryClient?: QueryClient;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  {
    route = "/",
    queryClient = createTestQueryClient(),
    ...options
  }: RenderWithProvidersOptions = {},
) {
  window.location.hash = route.startsWith("#") ? route : `#${route}`;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <I18nProvider>
            <PreferencesProvider>
              <ConfirmProvider>
                <HashRouter>{children}</HashRouter>
              </ConfirmProvider>
            </PreferencesProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...options }),
  };
}
