import { QueryClient } from "@tanstack/react-query";

export function createRendererQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });

  // Workspace and collection mutations keep this shared key current. Reuse it
  // across views instead of refetching the full workspace list on every mount.
  queryClient.setQueryDefaults(["workspaces_list"], { staleTime: Infinity });
  return queryClient;
}
