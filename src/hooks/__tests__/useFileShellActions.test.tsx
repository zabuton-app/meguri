// The feedback every place that opens a file externally, reveals it or copies
// its path gives (#682): a toast on failure, and one on a copied path.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/i18n/I18nProvider";
import { createTestQueryClient } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn<(...a: unknown[]) => Promise<void>>(),
  openFolder: vi.fn<(...a: unknown[]) => Promise<void>>(),
  copyFilePath: vi.fn<(...a: unknown[]) => Promise<void>>(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    openExternal: (...a: unknown[]) => mocks.openExternal(...a),
    openFolder: (...a: unknown[]) => mocks.openFolder(...a),
    copyFilePath: (...a: unknown[]) => mocks.copyFilePath(...a),
  },
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

const { useFileShellActions } = await import("../useFileShellActions");

function setup() {
  const qc = createTestQueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => useFileShellActions(), { wrapper });
  return { actions: result.current, invalidate };
}

describe("useFileShellActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("toasts when opening externally fails, and leaves the caches alone", async () => {
    mocks.openExternal.mockRejectedValue(new Error("file is missing"));
    const { actions, invalidate } = setup();
    actions.openExternal(7, "ws");
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not open externally",
        { description: "file is missing" },
      ),
    );
    expect(mocks.openExternal).toHaveBeenCalledWith(7, "ws");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("mirrors the recorded play once opening externally succeeds", async () => {
    mocks.openExternal.mockResolvedValue(undefined);
    const { actions, invalidate } = setup();
    actions.openExternal(7, "ws");
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("toasts when opening the folder fails", async () => {
    mocks.openFolder.mockRejectedValue(new Error("gone"));
    const { actions } = setup();
    actions.openFolder(7, "ws");
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    expect(mocks.openFolder).toHaveBeenCalledWith(7, "ws");
  });

  it("confirms a copied path", async () => {
    mocks.copyFilePath.mockResolvedValue(undefined);
    const { actions } = setup();
    actions.copyPath(7, "ws");
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
    expect(mocks.copyFilePath).toHaveBeenCalledWith(7, "ws");
  });

  it("toasts when copying the path fails", async () => {
    mocks.copyFilePath.mockRejectedValue(new Error("gone"));
    const { actions } = setup();
    actions.copyPath(7, "ws");
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
