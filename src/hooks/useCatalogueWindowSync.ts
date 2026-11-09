import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** A successful edit in a separate preview updates the other open window's
 * active catalogue queries. Local mutations keep their existing targeted
 * invalidations; fetched queries are never broadcast, avoiding refresh loops. */
export function useCatalogueWindowSync() {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("meguri.catalogue.windows.v1");
    const unsubscribe = client.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success")
        channel.postMessage("changed");
    });
    channel.onmessage = () => {
      void client.invalidateQueries({ refetchType: "active" });
    };
    return () => {
      unsubscribe();
      channel.close();
    };
  }, [client]);
}
