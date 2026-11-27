import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { renderWithProviders } from "@/test/renderWithProviders";

/** Asks two confirms back to back and lists how each was answered. */
function TwoConfirms() {
  const confirm = useConfirm();
  const [answers, setAnswers] = useState<string[]>([]);
  const record = (label: string) => (ok: boolean) =>
    setAnswers((prev) => [...prev, `${label}:${ok}`]);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void confirm({ message: "First?" }).then(record("first"));
          void confirm({ message: "Second?" }).then(record("second"));
        }}
      >
        ask
      </button>
      <output>{answers.join(",")}</output>
    </>
  );
}

/** A menu item that asks first, like the detail view's "Delete from index". */
function MenuConfirm() {
  const confirm = useConfirm();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => void confirm({ message: "Sure?" })}>
          delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("ConfirmProvider", () => {
  it("queues a confirm requested while another is open", async () => {
    renderWithProviders(<TwoConfirms />);
    fireEvent.click(screen.getByRole("button", { name: "ask" }));

    // The first prompt stays up; the second waits instead of replacing it.
    expect(await screen.findByText("First?")).toBeTruthy();
    expect(screen.queryByText("Second?")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Second?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "first:true,second:false",
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps focus inside while open and hands it back after", async () => {
    renderWithProviders(<TwoConfirms />);
    const ask = screen.getByRole("button", { name: "ask" });
    ask.focus();
    fireEvent.click(ask);

    // Named by the question when there is no title.
    await screen.findByRole("alertdialog", { name: "First?" });
    const ok = screen.getByRole("button", { name: "OK" });
    expect(document.activeElement).toBe(ok);
    fireEvent.keyDown(ok, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );

    fireEvent.click(ok);
    await screen.findByText("Second?");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(ask);
  });

  it("keeps focus when the menu that opened it hands focus to its trigger", async () => {
    renderWithProviders(<MenuConfirm />);
    const trigger = screen.getByRole("button", { name: "menu" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "delete" }));
    await screen.findByRole("alertdialog", { name: "Sure?" });
    // Radix returns focus to the trigger a tick after the menu closes.
    await new Promise((r) => setTimeout(r, 20));
    const dialog = screen.getByRole("alertdialog", { name: "Sure?" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    // The item that opened it is gone with the menu: back to the trigger.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("answers Enter on the focused Cancel button with cancel", async () => {
    renderWithProviders(<TwoConfirms />);
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    await screen.findByText("First?");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Enter" });
    await screen.findByText("Second?");
    fireEvent.keyDown(screen.getByRole("button", { name: "OK" }), {
      key: "Enter",
    });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "first:false,second:true",
      ),
    );
  });
});
