// The toolbar folds into its "more" menu as the title bar narrows (#578), so
// that it, the search box and the window buttons still fit.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { HomeHeader } from "@/routes/Home/HomeHeader";

/** Report every observed element as `width` px wide. */
function headerWidth(width: number): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe() {
        this.cb([{ contentRect: { width } } as ResizeObserverEntry], this);
      }
      disconnect() {}
      unobserve() {}
    },
  );
}

afterEach(() => vi.unstubAllGlobals());

const onSetView = vi.fn();

function renderHeader(view: "grid" | "graph" | "filmstrip" = "grid") {
  renderWithProviders(
    <HomeHeader
      root="/media"
      rootFetched
      collection={null}
      onEditCollection={() => {}}
      workspace={null}
      onEditWorkspace={() => {}}
      view={view}
      onSetView={onSetView}
      folderView={false}
      onToggleByFolder={() => {}}
      folderAvailable={false}
      scanning={false}
      ready
      onScan={() => {}}
      onScanWithDeleted={() => {}}
      onRebuild={() => {}}
      t={(k) => k}
    />,
  );
}

/** Open the "more" menu (Radix opens it on a pointer down). */
async function openMore(): Promise<void> {
  const trigger = screen.getByRole("button", { name: "home.moreTools" });
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  });
}

describe("HomeHeader's toolbar", () => {
  it("shows everything when there is room", () => {
    headerWidth(1000);
    renderHeader();
    screen.getByRole("link", { name: "history.title" });
    screen.getByRole("button", { name: "view.grid" });
    expect(screen.queryByRole("button", { name: "home.moreTools" })).toBeNull();
  });

  it("folds the page links into the menu first", async () => {
    headerWidth(700);
    renderHeader();
    expect(screen.queryByRole("link", { name: "history.title" })).toBeNull();
    screen.getByRole("button", { name: "view.grid" });
    await openMore();
    screen.getByRole("menuitem", { name: "history.title" });
    expect(
      screen.queryByRole("menuitemradio", { name: "view.grid" }),
    ).toBeNull();
  });

  it("folds the view controls too when narrower", async () => {
    headerWidth(500);
    renderHeader();
    expect(screen.queryByRole("button", { name: "view.grid" })).toBeNull();
    // Scan stays in the bar.
    expect(screen.getAllByRole("button", { name: "home.scan" })).not.toEqual(
      [],
    );
    await openMore();
    screen.getByRole("menuitemradio", { name: "view.grid", checked: true });
    screen.getByRole("menuitem", { name: "history.title" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "view.list" }));
    expect(onSetView).toHaveBeenCalledWith("list");
  });

  it("offers the filmstrip view", () => {
    headerWidth(1000);
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "view.filmstrip" }));
    expect(onSetView).toHaveBeenCalledWith("filmstrip");
  });

  it("tells why the folder toggle is off in the filmstrip", async () => {
    headerWidth(500);
    renderHeader("filmstrip");
    await openMore();
    const folder = screen.getByRole("menuitemcheckbox", {
      name: /view\.folder/,
    });
    expect(folder.getAttribute("aria-disabled")).toBe("true");
    expect(folder.textContent).toContain("view.folderUnavailableFilmstrip");
  });

  it("tells why the folded folder toggle is off", async () => {
    headerWidth(500);
    renderHeader("graph");
    await openMore();
    const folder = screen.getByRole("menuitemcheckbox", {
      name: /view\.folder/,
    });
    expect(folder.getAttribute("aria-disabled")).toBe("true");
    expect(folder.textContent).toContain("view.folderUnavailableGraph");
  });
});
