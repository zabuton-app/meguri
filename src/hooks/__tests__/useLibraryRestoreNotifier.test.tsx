import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppStatus } from "@shared/ipc/schema";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useLibraryRestoreNotifier } from "../useLibraryRestoreNotifier";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn<() => Promise<AppStatus>>(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { warning: mocks.warning }),
  Toaster: () => null,
}));
vi.mock("@/ipc/client", () => ({
  api: { appStatus: () => mocks.appStatus() },
}));

const status = (libraryRestoredFrom?: number): AppStatus => ({
  root: "/media",
  ready: true,
  initError: null,
  initErrorKind: null,
  mediaBase: null,
  workspaceId: "ws",
  devMode: false,
  libraryRestoredFrom,
});

function Probe() {
  useLibraryRestoreNotifier();
  return null;
}

describe("useLibraryRestoreNotifier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says when the library was damaged and a copy put back", async () => {
    mocks.appStatus.mockResolvedValue(status(1_700_000_000));
    renderWithProviders(<Probe />);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1));
    expect(String(mocks.warning.mock.calls[0][0])).toMatch(
      /^Your library was damaged, so Meguri restored the copy from /,
    );
  });

  it("says nothing when the library was sound", async () => {
    mocks.appStatus.mockResolvedValue(status());
    renderWithProviders(<Probe />);
    await waitFor(() => expect(mocks.appStatus).toHaveBeenCalled());
    expect(mocks.warning).not.toHaveBeenCalled();
  });
});
