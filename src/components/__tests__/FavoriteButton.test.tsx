// Regression test for the favorite toggle's optimistic cache sync: clicking must call the
// IPC mutation and patch the discovery queue cache in place (it is never refetched).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fileSetFavorite = vi.fn().mockResolvedValue(undefined);
vi.mock("@/ipc/client", () => ({
  api: {
    fileSetFavorite: (...args: unknown[]): Promise<void> =>
      fileSetFavorite(...args) as Promise<void>,
  },
  ALL_ID: "__all__",
}));

// Imported after the mock so FavoriteButton picks up the stubbed client.
const { FavoriteButton } = await import("@/components/FavoriteButton");
const { I18nProvider } = await import("@/i18n/I18nProvider");

function setup(favorite: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    ["files_random"],
    [{ id: 1, workspaceId: "ws", favorite, relPath: "a.mp4", kind: "video" }],
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
  render(<FavoriteButton fileId={1} workspaceId="ws" favorite={favorite} />, {
    wrapper,
  });
  return qc;
}

describe("FavoriteButton", () => {
  it("toggles on: calls the mutation and patches the files_random cache row to favorite=1", async () => {
    const qc = setup(0);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(btn);

    await waitFor(() =>
      expect(fileSetFavorite).toHaveBeenCalledWith(1, "ws", true),
    );
    await waitFor(() => {
      const rows = qc.getQueryData<{ id: number; favorite: number }[]>([
        "files_random",
      ]);
      expect(rows?.[0].favorite).toBe(1);
    });
  });

  it("reflects the current favorite state via aria-pressed", () => {
    setup(1);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
