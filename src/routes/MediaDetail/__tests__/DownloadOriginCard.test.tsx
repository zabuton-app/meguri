// The detail view's "Where from": what macOS recorded about a download.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DownloadOriginEntry } from "@shared/downloadOrigin";
import { I18nProvider } from "@/i18n/I18nProvider";

const fileDownloadOrigin =
  vi.fn<(id: number, workspaceId: string) => Promise<DownloadOriginEntry[]>>();
const openUrl = vi.fn<(url: string) => Promise<void>>();
vi.mock("@/ipc/client", () => ({
  api: {
    fileDownloadOrigin: (id: number, workspaceId: string) =>
      fileDownloadOrigin(id, workspaceId),
    openUrl: (url: string) => openUrl(url),
  },
}));

const { DownloadOriginCard } =
  await import("@/routes/MediaDetail/DownloadOriginCard");

const download: DownloadOriginEntry = {
  kind: "download",
  url: "https://cdn.example.com/media.png?sig=abc",
  hostname: "cdn.example.com",
};
const referrer: DownloadOriginEntry = {
  kind: "referrer",
  url: "https://example.com/photos/123/",
  hostname: "example.com",
};

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <DownloadOriginCard id={7} workspaceId="ws" />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

beforeEach(() => {
  fileDownloadOrigin.mockReset();
  openUrl.mockReset();
  openUrl.mockResolvedValue(undefined);
});

describe("DownloadOriginCard", () => {
  it("shows nothing for a file without a record", async () => {
    fileDownloadOrigin.mockResolvedValue([]);
    const { container, qc } = renderCard();
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(fileDownloadOrigin).toHaveBeenCalledWith(7, "ws");
    expect(container.firstChild).toBeNull();
  });

  it("names the page's site rather than the host that served the file", async () => {
    fileDownloadOrigin.mockResolvedValue([download, referrer]);
    renderCard();
    expect(await screen.findByText("example.com")).toBeTruthy();
    expect(screen.queryByText("cdn.example.com")).toBeNull();
  });

  it("falls back to the download host when there is no referrer", async () => {
    fileDownloadOrigin.mockResolvedValue([download]);
    renderCard();
    expect(await screen.findByText("cdn.example.com")).toBeTruthy();
  });

  it("opens the recorded URL as it is", async () => {
    fileDownloadOrigin.mockResolvedValue([download, referrer]);
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Download URL" }),
    );
    expect(openUrl).toHaveBeenCalledWith(download.url);
  });
});
