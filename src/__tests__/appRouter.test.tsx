// An app built on Meguri adds its own routes through renderApp's `routes`
// (#475); they sit beside Meguri's under the list, like /settings.
import { describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/appRouter";

vi.mock("@/ipc/client", () => ({
  api: new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) }),
  events: new Proxy({}, { get: () => vi.fn().mockReturnValue(() => {}) }),
}));

const childPaths = (router: ReturnType<typeof createAppRouter>) =>
  router.routes[0].children?.map((route) => route.path);

describe("createAppRouter", () => {
  it("has Meguri's routes only when the app adds none", () => {
    const router = createAppRouter();
    expect(childPaths(router)).toContain("settings");
    expect(childPaths(router)).not.toContain("sync");
    router.dispose();
  });

  it("adds the app's routes after Meguri's, under the same shell", () => {
    const router = createAppRouter([{ path: "sync", element: <p>sync</p> }]);
    const paths = childPaths(router);
    expect(paths?.at(-1)).toBe("sync");
    expect(paths).toContain("settings");
    router.dispose();
  });
});
