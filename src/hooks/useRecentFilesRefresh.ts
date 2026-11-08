import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SearchQuery } from "@/ipc/types";

/** Expire rolling/calendar results without walking or polling the filesystem. */
export function useRecentFilesRefresh(recent: SearchQuery["recent"]) {
  const qc = useQueryClient();
  const period = recent?.period;
  useEffect(() => {
    if (!period) return;
    const refresh = () => {
      if (document.hidden) return;
      for (const key of [
        "files_search",
        "graph_build",
        "activity_days",
        "timeline_counts",
      ])
        void qc.invalidateQueries({ queryKey: [key], refetchType: "active" });
    };
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [period, qc]);
}
