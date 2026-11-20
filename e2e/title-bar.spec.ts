import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { openSettings, searchFor } from "./fixtures/helpers";

// The custom title bar (#578). E2E runs on Linux, which gets the app's own
// window buttons; macOS keeps the OS's traffic lights instead.
//
// Playwright's clicks reach the page directly, not through the OS's hit test,
// so these cover what the page does (an overlay over the buttons, Radix
// switching off pointer events) and not the drag region's own behavior.
test.describe("Title bar", () => {
  // The settings modal is the app's own; the collection dialog is Radix's,
  // which sets pointer-events: none on <body> while it is open.
  for (const [modal, open] of [
    ["settings", (page: Page) => openSettings(page)],
    [
      "a Radix dialog",
      (page: Page) =>
        page.getByRole("button", { name: "Create user collection" }).click(),
    ],
  ] as const) {
    test(`keeps its window buttons clickable with ${modal} open`, async ({
      app,
      ready,
    }) => {
      // Count the calls rather than check the state: Xvfb has no window manager
      // to maximize the window.
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const g = globalThis as { maximizeCalls?: number };
        g.maximizeCalls = 0;
        const maximize = win.maximize.bind(win);
        win.maximize = () => {
          g.maximizeCalls! += 1;
          maximize();
        };
      });
      await open(ready);
      await ready
        .getByTestId("title-bar")
        // A Radix modal hides everything outside it from the accessibility
        // tree (aria-hidden), the title bar included.
        .getByRole("button", { name: "Maximize", includeHidden: true })
        .click();
      await expect
        .poll(() =>
          app.evaluate(
            () => (globalThis as { maximizeCalls?: number }).maximizeCalls,
          ),
        )
        .toBe(1);
      // Pressing a window button is not a click away from the dialog.
      await expect(ready.getByRole("dialog").first()).toBeVisible();
    });
  }

  test("keeps the window buttons and the toolbar usable in a narrow window", async ({
    app,
    ready,
  }) => {
    // The window's minimum width (electron/app.ts).
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(640, 600),
    );
    await expect
      .poll(() => ready.evaluate(() => window.innerWidth))
      .toBeLessThanOrEqual(640);
    const bar = ready.getByTestId("title-bar");
    // A trial click checks the button is the one hit at its own point.
    for (const name of ["Minimize", "Maximize", "Close"]) {
      await bar.getByRole("button", { name }).click({ trial: true });
    }
    // The toolbar folds into its menu rather than running off the end.
    await bar
      .getByRole("button", { name: "Scan", exact: true })
      .first()
      .click({ trial: true });
    await bar.getByRole("button", { name: "More" }).click();
    await expect(ready.getByRole("menuitem", { name: "Tags" })).toBeVisible();
  });

  test("holds Home's header, which goes quiet while a modal is open", async ({
    ready,
  }) => {
    const bar = ready.getByTestId("title-bar");
    await expect(
      bar.getByRole("button", { name: "Scan", exact: true }).first(),
    ).toBeVisible();
    // The list's search sits in the middle of the bar and still searches.
    await searchFor(ready, "needle");
    await expect(bar.locator('[data-slot="search-trigger"]')).toContainText(
      "needle",
    );
    await bar.getByRole("button", { name: "Clear search" }).click();
    // Whether a click at the middle of `el` reaches it, or something drawn
    // over it takes it.
    const onTop = (el: Locator) =>
      el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return node.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      });
    const search = bar.locator('[data-slot="search-trigger"]');
    // A popover is not a modal: Radix gives it role="dialog" too.
    await ready.locator('[data-slot="more-filters-trigger"]').click();
    await expect(ready.getByRole("dialog")).toBeVisible();
    expect(await onTop(search)).toBe(true);
    await ready.keyboard.press("Escape");
    // A modal's backdrop covers the bar with the page; the window buttons stay
    // above it.
    await openSettings(ready);
    expect(await onTop(search)).toBe(false);
    expect(
      await onTop(bar.getByRole("button", { name: "Close", exact: true })),
    ).toBe(true);
  });

  test("moves the window buttons to the left from the settings", async ({
    ready,
  }) => {
    const bar = ready.getByTestId("title-bar");
    const closeIsFirst = () =>
      bar.evaluate(
        (el) => !!el.firstElementChild?.querySelector('[aria-label="Close"]'),
      );
    expect(await closeIsFirst()).toBe(false);
    const dialog = await openSettings(ready);
    await dialog
      .locator("section", { hasText: "Window buttons" })
      .getByRole("button", { name: "Left" })
      .click();
    await expect.poll(closeIsFirst).toBe(true);
    // The buttons take the bar's left end, so the logo heads the rail.
    await expect(
      ready.locator('[data-slot="workspace-rail"] img').first(),
    ).toBeVisible();
    await expect(bar.locator("img")).toHaveCount(0);
  });

  test("hides the window buttons from the settings", async ({ app, ready }) => {
    // Narrow enough that the description wraps: the choices must not shrink
    // under it and cut "None" off.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(800, 700),
    );
    const bar = ready.getByTestId("title-bar");
    const dialog = await openSettings(ready);
    const section = dialog.locator("section", { hasText: "Window buttons" });
    const none = section.getByRole("button", { name: "None" });
    const [box, sectionBox] = await Promise.all([
      none.boundingBox(),
      section.boundingBox(),
    ]);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      sectionBox!.x + sectionBox!.width,
    );
    await none.click();
    await expect(
      bar.getByRole("button", { name: "Close", includeHidden: true }),
    ).toHaveCount(0);
  });
});
