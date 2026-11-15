import { describe, expect, it, vi } from "vitest";
import { createRendererQueryClient } from "@/lib/queryClient";

describe("workspaces_list query defaults", () => {
  it("reuses the cached list across views until it is invalidated", async () => {
    const queryClient = createRendererQueryClient();
    const queryFn = vi.fn(async () => ({ workspaces: [], collections: [] }));
    const query = { queryKey: ["workspaces_list"], queryFn };

    await queryClient.fetchQuery(query);
    await queryClient.fetchQuery(query);

    expect(queryFn).toHaveBeenCalledTimes(1);

    await queryClient.invalidateQueries({ queryKey: ["workspaces_list"] });
    await queryClient.fetchQuery(query);

    expect(queryFn).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });
});
