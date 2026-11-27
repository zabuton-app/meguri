// The detail view's open externally, open folder and copy path give the same
// feedback as the context menu (#682): a toast on failure, and one on a
// copied path.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { FileDetail } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { renderWithProviders } from "@/test/renderWithProviders";

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

const { DetailActions } = await import("../DetailActions");
const { useDetailMutations } = await import("../useDetailMutations");

const WS = "ws-test";

function Harness() {
  const { t } = useI18n();
  const actions = useDetailMutations({ fileId: 3, wsId: WS });
  return (
    <DetailActions
      detail={{ id: 3, kind: "video", relPath: "a/b.mp4" } as FileDetail}
      basename="b.mp4"
      dir="a"
      fileId={3}
      wsId={WS}
      mediaSrc=""
      collections={[]}
      imageBgInverted={false}
      onToggleImageBg={() => {}}
      onOpenExternal={actions.openExternal}
      onDeleteFromIndex={() => {}}
      onAddToCollection={() => {}}
      onRemoveFromCollection={() => {}}
      t={t}
    />
  );
}

/** Opens the "more actions" menu and picks `name` from it. */
async function pickMoreAction(name: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}

describe("detail view file actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("toasts when opening externally fails", async () => {
    mocks.openExternal.mockRejectedValue(new Error("gone"));
    renderWithProviders(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open externally" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not open externally",
        { description: "gone" },
      ),
    );
    expect(mocks.openExternal).toHaveBeenCalledWith(3, WS);
  });

  it("toasts when opening the folder fails", async () => {
    mocks.openFolder.mockRejectedValue(new Error("gone"));
    renderWithProviders(<Harness />);

    await pickMoreAction("Open containing folder");

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    expect(mocks.openFolder).toHaveBeenCalledWith(3, WS);
  });

  it("confirms a copied path", async () => {
    mocks.copyFilePath.mockResolvedValue(undefined);
    renderWithProviders(<Harness />);

    await pickMoreAction("Copy File Path");

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
    expect(mocks.copyFilePath).toHaveBeenCalledWith(3, WS);
  });

  it("toasts when copying the path fails", async () => {
    mocks.copyFilePath.mockRejectedValue(new Error("gone"));
    renderWithProviders(<Harness />);

    await pickMoreAction("Copy File Path");

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
  });
});
