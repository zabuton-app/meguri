// An app built on Meguri adds its own settings tabs through renderApp's
// `settingsSections` (#475); they follow Meguri's tabs and render their own
// panel.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import Settings from "@/routes/Settings";
import {
  ExtraSettingsSectionsProvider,
  type SettingsSection,
} from "@/settings/extraSections";
import { renderWithProviders } from "@/test/renderWithProviders";

// Every IPC call the tabs make resolves to nothing; these tests only look at
// the tab bar and the extra panel.
vi.mock("@/ipc/client", () => ({
  api: new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) }),
  events: new Proxy({}, { get: () => vi.fn().mockReturnValue(() => {}) }),
}));

const SECTION: SettingsSection = {
  id: "sync",
  label: (lang) => (lang === "ja" ? "同期" : "Sync"),
  Component: () => <p>sync settings</p>,
};

function renderSettings(sections: readonly SettingsSection[]) {
  return renderWithProviders(
    <ExtraSettingsSectionsProvider value={sections}>
      <Settings />
    </ExtraSettingsSectionsProvider>,
    { route: "/settings" },
  );
}

describe("Settings with an app's own sections", () => {
  it("shows only Meguri's tabs when the app adds none", () => {
    renderSettings([]);
    expect(screen.getAllByRole("tab")).toHaveLength(6);
  });

  it("adds the app's tab after Meguri's, labelled for the current language", () => {
    renderSettings([SECTION]);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(7);
    expect(tabs[6].textContent).toBe(
      document.documentElement.lang === "ja" ? "同期" : "Sync",
    );
  });

  it("renders the app's section in its own panel when its tab is chosen", () => {
    renderSettings([SECTION]);
    expect(screen.queryByText("sync settings")).toBeNull();

    fireEvent.click(screen.getAllByRole("tab")[6]);

    const panel = screen.getByRole("tabpanel");
    expect(panel.id).toBe("settings-panel-extra-sync");
    expect(panel.textContent).toContain("sync settings");
  });
});
