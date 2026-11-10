import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppStatus } from "@shared/ipc/schema";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useConfigProblemNotifier } from "../useConfigProblemNotifier";

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

const status = (configProblem?: AppStatus["configProblem"]): AppStatus => ({
  root: "/media",
  ready: true,
  initError: null,
  initErrorKind: null,
  mediaBase: null,
  workspaceId: "ws",
  devMode: false,
  configProblem,
});

function Probe() {
  useConfigProblemNotifier();
  return null;
}

describe("useConfigProblemNotifier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says when config.json was damaged and moved aside", async () => {
    mocks.appStatus.mockResolvedValue(status("moved-aside"));
    renderWithProviders(<Probe />);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1));
    expect(String(mocks.warning.mock.calls[0][0])).toMatch(/was damaged/);
  });

  it("says when config.json could not be read", async () => {
    mocks.appStatus.mockResolvedValue(status("unreadable"));
    renderWithProviders(<Probe />);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1));
    expect(String(mocks.warning.mock.calls[0][0])).toMatch(/could not read/);
  });

  it("says nothing when config.json was fine", async () => {
    mocks.appStatus.mockResolvedValue(status());
    renderWithProviders(<Probe />);
    await waitFor(() => expect(mocks.appStatus).toHaveBeenCalled());
    expect(mocks.warning).not.toHaveBeenCalled();
  });
});
