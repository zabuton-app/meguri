// The status bar: the scope's total, the folders and files the view shows on
// the left; last scan and processing on the right.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { StatusBar } from "@/components/StatusBar";
import { setListCounts } from "@/hooks/useListCounts";
import { defaultAppStatus } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

const live = vi.hoisted(() => ({ listeners: 0 }));
const listen = vi.hoisted(() => () => {
  live.listeners++;
  return () => {
    live.listeners--;
  };
});

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => Promise.resolve(defaultAppStatus),
    workspaceStats: () =>
      Promise.resolve({ fileCount: 1234, lastScanAt: null }),
  },
  events: {
    onScanProgress: listen,
    onScanDone: listen,
    onWorkspaceChanged: listen,
  },
  ALL_ID: "__all__",
}));

afterEach(() => setListCounts(null));

const bar = () => screen.getByRole("contentinfo", { name: "Status bar" });

describe("StatusBar counts", () => {
  it("shows the total as what is shown when nothing narrows the view", async () => {
    renderWithProviders(<StatusBar />);
    expect(await screen.findByText("1,234 files in total")).toBeTruthy();
    expect(screen.getByText("1,234 shown")).toBeTruthy();
    expect(screen.queryByText(/folders$/)).toBeNull();
  });

  it("shows a browsed folder's folders and files", async () => {
    renderWithProviders(<StatusBar />);
    await screen.findByText("1,234 files in total");
    act(() => setListCounts({ files: 8, more: false, folders: 3 }));
    expect(screen.getByText("3 folders")).toBeTruthy();
    expect(screen.getByText("8 shown")).toBeTruthy();
  });

  it("marks a count that more pages would raise", async () => {
    renderWithProviders(<StatusBar />);
    await screen.findByText("1,234 files in total");
    act(() => setListCounts({ files: 500, more: true, folders: null }));
    expect(screen.getByText("500+ shown")).toBeTruthy();
  });

  it("puts the last scan on the right, beside the processing status", async () => {
    renderWithProviders(<StatusBar />);
    await screen.findByText("1,234 files in total");
    const [left, right] = Array.from(bar().children);
    expect(within(left as HTMLElement).queryByText(/Last scan/)).toBeNull();
    expect(within(right as HTMLElement).getByText(/Last scan/)).toBeTruthy();
  });

  // A cleanup that runs in the same tick as the subscription (StrictMode's
  // replay, a quick unmount) must still take every listener down (#271).
  it("removes its event listeners when unmounted right after mounting", () => {
    const { unmount } = renderWithProviders(<StatusBar />);
    expect(live.listeners).toBe(3);
    unmount();
    expect(live.listeners).toBe(0);
  });
});
