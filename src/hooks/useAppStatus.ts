import { useQuery } from "@tanstack/react-query";
import type { AppStatus } from "@shared/ipc/schema";
import { api } from "@/ipc/client";

/** `refetchInterval` lets a caller keep the status fresh while it waits on a
 *  change main announces only once (LibraryMergeModal). */
export function useAppStatus(options?: {
  refetchInterval?: (data: AppStatus | undefined) => number | false;
}) {
  const interval = options?.refetchInterval;
  return useQuery({
    queryKey: ["app_status"],
    queryFn: api.appStatus,
    refetchInterval: interval ? (q) => interval(q.state.data) : undefined,
  });
}
