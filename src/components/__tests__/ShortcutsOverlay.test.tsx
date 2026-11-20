import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { ShortcutsOverlay } from "@/components/ShortcutsOverlay";
import { renderWithProviders } from "@/test/renderWithProviders";

function renderOverlay(preset?: "normal" | "vim" | "emacs") {
  localStorage.setItem("meguri.lang", "en");
  if (preset) {
    localStorage.setItem(
      "meguri.prefs",
      JSON.stringify({ keybindingPreset: preset }),
    );
  }
  const onClose = vi.fn();
  const onOpenSettings = vi.fn();
  renderWithProviders(
    <ShortcutsOverlay onClose={onClose} onOpenSettings={onOpenSettings} />,
  );
  return { onClose, onOpenSettings };
}

/** The keycaps of the row whose label is `label`, as text. */
function rowKeys(label: string): string[] {
  const row = screen.getByText(label).closest("li");
  if (!row) throw new Error(`no row ${label}`);
  return within(row)
    .getAllByText((_, el) => el?.tagName === "KBD")
    .map((k) => k.textContent ?? "");
}

afterEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

describe("ShortcutsOverlay", () => {
  it("has a section for every screen", () => {
    renderOverlay();
    for (const title of [
      "General",
      "List",
      "Detail",
      "Playback",
      "Player",
      "Discover",
      "Graph",
    ]) {
      expect(
        screen.getByRole("heading", {
          level: 3,
          name: new RegExp(`^${title}`),
        }),
      ).toBeTruthy();
    }
  });

  it("lists the playlist player, Discover, image paging and zoom keys", () => {
    renderOverlay("normal");
    expect(rowKeys("Previous / next")).toEqual(["P", "N", "[", "]"]);
    expect(rowKeys("Toggle shuffle")).toEqual(["S"]);
    expect(rowKeys("Open the current file's details")).toEqual(["I"]);
    expect(rowKeys("Leave the player")).toEqual(["Esc"]);
    expect(rowKeys("Previous / next (images and audio)")).toEqual(["←", "→"]);
    expect(rowKeys("Previous / next card")).toEqual(["[", "]", "←", "→"]);
    expect(rowKeys("Shuffle again")).toEqual(["R"]);
    const discover = screen.getByRole("region", { name: /^Discover/ });
    expect(within(discover).getByText("Close")).toBeTruthy();
    expect(rowKeys("Previous / next file (images)")).toEqual(["←", "→"]);
    expect(rowKeys("Zoom in / out")).toEqual(["Ctrl", "+", "Ctrl", "-"]);
    expect(rowKeys("Reset zoom")).toEqual(["Ctrl", "0"]);
  });

  it("takes the preset's keys from the active preset", () => {
    renderOverlay("emacs");
    expect(screen.getByText("Emacs")).toBeTruthy();
    expect(rowKeys("Previous / next card")).toEqual([
      "Ctrl",
      "b",
      "Ctrl",
      "f",
      "←",
      "→",
    ]);
    expect(rowKeys("Search")).toEqual(["/"]);
  });

  it("narrows the rows by action or key, and says when nothing matches", () => {
    renderOverlay("vim");
    const filter = screen.getByRole("searchbox", { name: "Filter shortcuts" });

    fireEvent.change(filter, { target: { value: "shuffle" } });
    expect(screen.getByText("Toggle shuffle")).toBeTruthy();
    expect(screen.getByText("Shuffle again")).toBeTruthy();
    expect(screen.queryByText("Toggle mute")).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Graph/ })).toBeNull();

    fireEvent.change(filter, { target: { value: "ctrl 0" } });
    expect(screen.getByText("Reset zoom")).toBeTruthy();
    expect(screen.queryByText("Zoom in / out")).toBeNull();

    // Written the way the keys used to be shown.
    fireEvent.change(filter, { target: { value: "ctrl+0" } });
    expect(screen.getByText("Reset zoom")).toBeTruthy();

    fireEvent.change(filter, { target: { value: "nothing like this" } });
    expect(
      screen.getByText("No shortcuts match “nothing like this”"),
    ).toBeTruthy();
  });

  it("types ? into the filter instead of closing, but Esc still closes", () => {
    const { onClose } = renderOverlay();
    const filter = screen.getByRole("searchbox", { name: "Filter shortcuts" });
    filter.focus();

    fireEvent.keyDown(filter, { key: "?", code: "Slash", shiftKey: true });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(filter, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on ? outside the filter", () => {
    const { onClose } = renderOverlay();
    fireEvent.keyDown(window, { key: "?", code: "Slash", shiftKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens Settings from the preset link", () => {
    const { onClose, onOpenSettings } = renderOverlay();
    fireEvent.click(screen.getByRole("button", { name: "Change in Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});
