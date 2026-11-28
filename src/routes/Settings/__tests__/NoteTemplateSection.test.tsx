// The note template in Settings › Library (#345): edited with the note's own
// editor and saved as the user types.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { NOTE_TEMPLATE_QUERY_KEY } from "@/hooks/useNoteTemplate";
import {
  createTestQueryClient,
  renderWithProviders,
} from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  noteTemplateGet: vi.fn(),
  noteTemplateSet: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    noteTemplateGet: (): Promise<unknown> =>
      mocks.noteTemplateGet() as Promise<unknown>,
    noteTemplateSet: (template: string): Promise<unknown> =>
      mocks.noteTemplateSet(template) as Promise<unknown>,
  },
}));

const { NoteTemplateSection } =
  await import("@/routes/Settings/NoteTemplateSection");

beforeEach(() => {
  mocks.noteTemplateGet.mockReset().mockResolvedValue("");
  mocks.noteTemplateSet
    .mockReset()
    .mockImplementation((template: string) => Promise.resolve(template));
});

function editorEl(): HTMLElement {
  return screen.getByLabelText("Note template", {
    selector: "[contenteditable]",
  });
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

describe("NoteTemplateSection", () => {
  it("shows the stored template in the editor", async () => {
    mocks.noteTemplateGet.mockResolvedValue("## Source");
    renderWithProviders(<NoteTemplateSection />);
    expect(await screen.findByRole("heading", { name: "Source" })).toBeTruthy();
    expect(editorEl().contains(screen.getByRole("heading"))).toBe(true);
  });

  it("saves the template once typing pauses", async () => {
    const queryClient = createTestQueryClient();
    renderWithProviders(<NoteTemplateSection />, { queryClient });
    await screen.findByLabelText("Note template", {
      selector: "[contenteditable]",
    });
    paste("Licence:");
    expect(mocks.noteTemplateSet).not.toHaveBeenCalled();
    await waitFor(
      () => expect(mocks.noteTemplateSet).toHaveBeenCalledWith("Licence:"),
      { timeout: 3000 },
    );
    await screen.findByText("Saved");
    expect(queryClient.getQueryData(NOTE_TEMPLATE_QUERY_KEY)).toBe("Licence:");
  });

  it("leaves the editor on Esc, so the next Esc closes Settings", async () => {
    renderWithProviders(<NoteTemplateSection />);
    const field = await screen.findByLabelText("Note template", {
      selector: "[contenteditable]",
    });
    field.focus();
    expect(document.activeElement).toBe(field);
    // ProseMirror claims every Esc it sees, which Settings reads as handled
    // by a layer on top: the first one has to take the focus out.
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).not.toBe(field);
  });

  it("keeps the text and offers a retry when saving fails", async () => {
    mocks.noteTemplateSet.mockRejectedValueOnce(new Error("disk full"));
    renderWithProviders(<NoteTemplateSection />);
    await screen.findByLabelText("Note template", {
      selector: "[contenteditable]",
    });
    paste("Licence:");
    const retry = await screen.findByRole(
      "button",
      { name: "Retry" },
      { timeout: 3000 },
    );
    expect(editorEl().textContent).toContain("Licence:");
    fireEvent.click(retry);
    await screen.findByText("Saved");
    expect(mocks.noteTemplateSet).toHaveBeenCalledTimes(2);
  });
});
