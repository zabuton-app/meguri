import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type {
  AppStatus,
  LibraryMergeEvent,
  LibraryMergeFailure,
} from "@shared/ipc/schema";
import { renderWithProviders } from "@/test/renderWithProviders";
import { LibraryMergeModal } from "../LibraryMergeModal";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn<() => Promise<AppStatus>>(),
  listener: null as ((e: LibraryMergeEvent) => void) | null,
  warning: vi.fn(),
  retry: vi.fn(() => Promise.resolve()),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { warning: mocks.warning }),
  Toaster: () => null,
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    libraryMergeRetry: () => mocks.retry(),
  },
  events: {
    onLibraryMerge: (cb: (e: LibraryMergeEvent) => void) => {
      mocks.listener = cb;
      return () => {
        mocks.listener = null;
      };
    },
  },
}));

const status = (
  libraryMerge?: { done: number; total: number },
  libraryMergeFailed?: LibraryMergeFailure[],
  libraryRestoredFrom?: number,
): AppStatus => ({
  root: null,
  ready: libraryMerge === undefined,
  initError: null,
  initErrorKind: null,
  mediaBase: null,
  workspaceId: null,
  devMode: false,
  libraryMerge,
  libraryMergeFailed,
  libraryRestoredFrom,
});

const emit = (e: LibraryMergeEvent) =>
  act(() => {
    mocks.listener?.(e);
  });

describe("LibraryMergeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listener = null;
  });

  it("shows nothing when no merge is due", async () => {
    mocks.appStatus.mockResolvedValue(status());
    renderWithProviders(<LibraryMergeModal />);
    await waitFor(() => expect(mocks.appStatus).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("follows the merge from the status, then the events, and closes when it is done", async () => {
    mocks.appStatus.mockResolvedValue(status({ done: 0, total: 3 }));
    renderWithProviders(<LibraryMergeModal />);
    expect(await screen.findByText("0 / 3 workspaces")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();

    await waitFor(() => expect(mocks.listener).not.toBeNull());
    emit({ state: "running", done: 2, total: 3 });
    expect(screen.getByText("2 / 3 workspaces")).toBeTruthy();

    mocks.appStatus.mockResolvedValue(status());
    emit({ state: "done", failed: [] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it("says which workspaces could not be merged, and why, with a way to try again", async () => {
    mocks.appStatus.mockResolvedValue(status({ done: 0, total: 2 }));
    renderWithProviders(<LibraryMergeModal />);
    await screen.findByRole("dialog");
    await waitFor(() => expect(mocks.listener).not.toBeNull());

    emit({ state: "done", failed: [{ label: "Videos", reason: "diskFull" }] });

    expect(mocks.warning).toHaveBeenCalledTimes(1);
    const [title, options] = mocks.warning.mock.calls[0] as [
      string,
      {
        description: ReactElement<{ children: string }>;
        action: { label: string; onClick: () => void };
      },
    ];
    expect(title).toBe("Some workspaces could not be moved");
    expect(options.description.props.children).toBe(
      "Videos: The disk is full. Free some space, then try again.\nThey keep working as before. Meguri tries again at the next launch.",
    );
    expect(options.action.label).toBe("Try again");

    // Trying again: the modal follows the second run.
    act(() => options.action.onClick());
    expect(mocks.retry).toHaveBeenCalledTimes(1);
    emit({ state: "running", done: 0, total: 1 });
    expect(await screen.findByText("0 / 1 workspaces")).toBeTruthy();
  });

  it("comes back on a retry from the status, before any progress event", async () => {
    mocks.appStatus.mockResolvedValue(
      status(undefined, [{ label: "Videos", reason: "merge" }]),
    );
    renderWithProviders(<LibraryMergeModal />);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1));
    const [, options] = mocks.warning.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];

    // Main reports the retry pending as soon as it takes it.
    mocks.appStatus.mockResolvedValue(status({ done: 0, total: 1 }));
    act(() => options.action.onClick());
    expect(await screen.findByText("0 / 1 workspaces")).toBeTruthy();
    // The failures read before the retry are not told again.
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it("closes from the status when the event that ends the merge went unheard", async () => {
    mocks.appStatus.mockResolvedValue(status({ done: 1, total: 2 }));
    renderWithProviders(<LibraryMergeModal />);
    await screen.findByRole("dialog");

    // The merge ends without this component hearing it: the next poll says so.
    mocks.appStatus.mockResolvedValue(
      status(undefined, [{ label: "Videos", reason: "merge" }]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), {
      timeout: 3000,
    });
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it("tells about failures of a merge that ended before the window asked", async () => {
    mocks.appStatus.mockResolvedValue(
      status(undefined, [{ label: "Videos", reason: "merge" }]),
    );
    renderWithProviders(<LibraryMergeModal />);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
