// The detail view's photo details (#725): what the photo's EXIF says, read
// when the view opens, with only the fields it gives.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PhotoDetailsResult } from "@shared/photoInfo";
import { I18nProvider } from "@/i18n/I18nProvider";

const filePhotoDetails =
  vi.fn<
    (id: number, workspaceId: string) => Promise<PhotoDetailsResult | null>
  >();
vi.mock("@/ipc/client", () => ({
  api: {
    filePhotoDetails: (id: number, workspaceId: string) =>
      filePhotoDetails(id, workspaceId),
  },
}));

const { PhotoDetailsCard } =
  await import("@/routes/MediaDetail/PhotoDetailsCard");

function renderCard(id = 7) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (fileId: number) => (
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <PhotoDetailsCard key={fileId} id={fileId} workspaceId="ws" />
      </I18nProvider>
    </QueryClientProvider>
  );
  const view = render(ui(id));
  return { ...view, qc, show: (next: number) => view.rerender(ui(next)) };
}

/** The value next to a field's name. */
const field = (name: string) =>
  screen.queryByText(name)?.nextElementSibling?.textContent ?? null;

beforeEach(() => {
  filePhotoDetails.mockReset();
});

describe("PhotoDetailsCard", () => {
  it("lists the fields the photo gives, with enum values translated", async () => {
    filePhotoDetails.mockResolvedValue({
      status: "ok",
      details: {
        make: "Canon",
        model: "Canon EOS R5",
        meteringMode: 5,
        flashFired: false,
        focalLength: 6.765,
        focalLength35mm: 24,
      },
    });
    renderCard();
    expect(await screen.findByText("Canon EOS R5")).toBeTruthy();
    expect(screen.getByText("Photo details")).toBeTruthy();
    expect(filePhotoDetails).toHaveBeenCalledWith(7, "ws");
    expect(field("Camera")).toBe("Canon EOS R5");
    expect(field("Metering mode")).toBe("Pattern");
    expect(field("Flash")).toBe("Did not fire");
    expect(field("Focal length")).toBe("6.8 mm (24 mm equiv.)");
    expect(screen.queryByText("Lens")).toBeNull();
  });

  it("names its time the local time where the photo was taken", async () => {
    // Not "Captured": the chip above shows the same moment in this
    // computer's time zone, which can differ.
    filePhotoDetails.mockResolvedValue({
      status: "ok",
      details: { takenAt: 1_563_687_300, takenOffset: "+09:00" },
    });
    renderCard();
    expect(await screen.findByText("Local time where taken")).toBeTruthy();
    expect(field("Local time where taken")).toBe(
      `${new Date(1_563_687_300 * 1000).toLocaleString("en")} (+09:00)`,
    );
  });

  it("shows nothing for a photo without details", async () => {
    filePhotoDetails.mockResolvedValue({ status: "ok", details: {} });
    const { container, qc } = renderCard();
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(container.firstChild).toBeNull();
  });

  it("shows nothing for a file that is not an image", async () => {
    filePhotoDetails.mockResolvedValue(null);
    const { container, qc } = renderCard();
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(container.firstChild).toBeNull();
  });

  it("says when the file could not be read", async () => {
    filePhotoDetails.mockResolvedValue({ status: "unreadable" });
    renderCard();
    expect(await screen.findByText("Could not read the file.")).toBeTruthy();
  });

  it("shows the next photo's details, not the last one's", async () => {
    filePhotoDetails.mockImplementation((id) =>
      Promise.resolve({
        status: "ok",
        details: { model: id === 7 ? "Canon EOS R5" : "NIKON D850" },
      }),
    );
    const { show } = renderCard(7);
    expect(await screen.findByText("Canon EOS R5")).toBeTruthy();
    show(8);
    expect(await screen.findByText("NIKON D850")).toBeTruthy();
    expect(screen.queryByText("Canon EOS R5")).toBeNull();
  });

  it("shows its rows as soon as they are read, without a toggle", async () => {
    filePhotoDetails.mockResolvedValue({
      status: "ok",
      details: { model: "Canon EOS R5" },
    });
    const { container } = renderCard();
    expect(await screen.findByText("Canon EOS R5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Photo details" })).toBeTruthy();
    expect(field("Camera")).toBe("Canon EOS R5");
    expect(container.querySelector("details")).toBeNull();
  });

  it("shows a placeholder while the photo is being read", async () => {
    filePhotoDetails.mockReturnValue(new Promise(() => {}));
    const { container } = renderCard();
    expect(
      await screen.findByRole("heading", { name: "Photo details" }),
    ).toBeTruthy();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});
