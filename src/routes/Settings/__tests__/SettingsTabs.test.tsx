import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsTabs, type SettingsTab } from "@/routes/Settings/SettingsTabs";

type Id = "general" | "library" | "app";

const TABS: readonly SettingsTab<Id>[] = [
  { id: "general", label: "General" },
  { id: "library", label: "Library" },
  { id: "app", label: "App" },
];

function renderTabs(value: Id = "general") {
  const onChange = vi.fn();
  render(
    <SettingsTabs
      tabs={TABS}
      value={value}
      onChange={onChange}
      label="Settings"
    />,
  );
  return { onChange };
}

describe("SettingsTabs", () => {
  it("renders one tab per entry inside a labelled tab list", () => {
    renderTabs();
    expect(screen.getByRole("tablist", { name: "Settings" })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("marks only the current tab as selected", () => {
    renderTabs("library");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((el) => el.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("keeps exactly one tab in the tab order", () => {
    renderTabs("library");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((el) => el.getAttribute("tabindex"))).toEqual([
      "-1",
      "0",
      "-1",
    ]);
  });

  it("points each tab at the panel it controls", () => {
    renderTabs();
    const tab = screen.getByRole("tab", { name: "Library" });
    expect(tab.id).toBe("settings-tab-library");
    expect(tab.getAttribute("aria-controls")).toBe("settings-panel-library");
  });

  it("reports the tab that was clicked", () => {
    const { onChange } = renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "App" }));
    expect(onChange).toHaveBeenCalledWith("app");
  });

  it("moves forward with the right and down arrows", () => {
    const { onChange } = renderTabs("general");
    fireEvent.keyDown(screen.getByRole("tab", { name: "General" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith("library");
    fireEvent.keyDown(screen.getByRole("tab", { name: "General" }), {
      key: "ArrowDown",
    });
    expect(onChange).toHaveBeenLastCalledWith("library");
  });

  it("moves backward with the left and up arrows", () => {
    const { onChange } = renderTabs("library");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Library" }), {
      key: "ArrowLeft",
    });
    expect(onChange).toHaveBeenCalledWith("general");
  });

  it("wraps around at both ends", () => {
    const first = renderTabs("app");
    fireEvent.keyDown(screen.getByRole("tab", { name: "App" }), {
      key: "ArrowRight",
    });
    expect(first.onChange).toHaveBeenCalledWith("general");
  });

  it("jumps to the ends with Home and End", () => {
    const { onChange } = renderTabs("library");
    const tab = screen.getByRole("tab", { name: "Library" });
    fireEvent.keyDown(tab, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith("general");
    fireEvent.keyDown(tab, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("app");
  });

  it("leaves other keys alone", () => {
    const { onChange } = renderTabs();
    fireEvent.keyDown(screen.getByRole("tab", { name: "General" }), {
      key: "Enter",
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the list reachable when the value matches no tab", () => {
    // A stale id must not leave every tab at tabIndex -1.
    render(
      <SettingsTabs
        tabs={TABS}
        value={"gone" as Id}
        onChange={vi.fn()}
        label="Settings"
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(
      tabs.filter((el) => el.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
  });
});
