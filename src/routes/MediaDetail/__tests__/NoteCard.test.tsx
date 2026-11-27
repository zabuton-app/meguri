// The note card: Markdown shown in place, edited with the same editor, and
// written as the user types, with what is left written when the card goes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import NoteCard from "@/routes/MediaDetail/NoteCard";
import { renderWithProviders } from "@/test/renderWithProviders";
import { NOTE_MAX_CHARS } from "@shared/note";

const mocks = vi.hoisted(() => ({
  fileSetNote: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    fileSetNote: (...args: unknown[]): Promise<unknown> =>
      mocks.fileSetNote(...args) as Promise<unknown>,
    openUrl: (url: string): Promise<unknown> =>
      mocks.openUrl(url) as Promise<unknown>,
  },
}));

beforeEach(() => {
  mocks.fileSetNote.mockReset().mockResolvedValue(undefined);
  mocks.openUrl.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

function editorEl(): HTMLElement {
  return screen.getByLabelText("Note", { selector: "[contenteditable]" });
}

/** Paste plain text where the cursor is, as the clipboard would. */
function paste(text: string): void {
  fireEvent.paste(editorEl(), {
    clipboardData: {
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
}

describe("NoteCard", () => {
  it("shows the stored Markdown and writes nothing when it is only read", () => {
    const { unmount } = renderWithProviders(
      <NoteCard
        fileId={1}
        wsId="ws"
        note={"### Source\n\n[Pexels](https://www.pexels.com/video/1/)"}
      />,
    );
    expect(screen.getByRole("heading", { name: "Source" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pexels" })).toBeTruthy();
    unmount();
    expect(mocks.fileSetNote).not.toHaveBeenCalled();
  });

  it("opens a link through open_url rather than navigating the window", () => {
    renderWithProviders(
      <NoteCard
        fileId={1}
        wsId="ws"
        note="[Pexels](https://www.pexels.com/video/1/)"
      />,
    );
    const link = screen.getByRole("link", { name: "Pexels" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(mocks.openUrl).toHaveBeenCalledWith(
      "https://www.pexels.com/video/1/",
    );
  });

  it("writes the note once typing pauses", async () => {
    renderWithProviders(<NoteCard fileId={7} wsId="ws" note={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Add a note/ }));
    paste("hello");
    expect(mocks.fileSetNote).not.toHaveBeenCalled();
    await waitFor(
      () => expect(mocks.fileSetNote).toHaveBeenCalledWith(7, "ws", "hello"),
      { timeout: 3000 },
    );
    await screen.findByText("Saved");
  });

  it("writes what is left at once when the card goes away", () => {
    const { unmount } = renderWithProviders(
      <NoteCard fileId={7} wsId="ws" note={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add a note/ }));
    paste("unsaved");
    unmount();
    expect(mocks.fileSetNote).toHaveBeenCalledWith(7, "ws", "unsaved");
  });

  it("keeps the text and offers a retry when the write fails", async () => {
    mocks.fileSetNote.mockRejectedValueOnce(new Error("disk full"));
    renderWithProviders(<NoteCard fileId={7} wsId="ws" note={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Add a note/ }));
    paste("keep me");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText("keep me")).toBeTruthy();
    fireEvent.click(retry);
    await screen.findByText("Saved");
    expect(mocks.fileSetNote).toHaveBeenCalledTimes(2);
    expect(mocks.fileSetNote).toHaveBeenLastCalledWith(7, "ws", "keep me");
  });

  it("finishes editing on Esc without letting the key through", () => {
    renderWithProviders(<NoteCard fileId={7} wsId="ws" note="text" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      editorEl().dispatchEvent(esc);
    });
    expect(esc.defaultPrevented).toBe(true);
    expect(screen.queryByRole("toolbar", { name: "Formatting" })).toBeNull();
  });

  it("shows a note changed elsewhere, even one over the editing limit", () => {
    const { rerender, unmount } = renderWithProviders(
      <NoteCard fileId={7} wsId="ws" note="short" />,
    );
    // Two notes joined by a merge can run past the limit the editor keeps.
    const merged = `${"x".repeat(NOTE_MAX_CHARS)}\n\n---\n\nmerged tail`;
    rerender(<NoteCard fileId={7} wsId="ws" note={merged} />);
    expect(screen.getByText("merged tail")).toBeTruthy();
    expect(screen.queryByText("short")).toBeNull();
    // Taking it in is not an edit: nothing is written back.
    unmount();
    expect(mocks.fileSetNote).not.toHaveBeenCalled();
  });

  it("does not link an address that is not http(s)", () => {
    renderWithProviders(
      <NoteCard
        fileId={1}
        wsId="ws"
        note="[bare](example.com) [js](javascript:alert(1))"
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
