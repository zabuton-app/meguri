import path from "node:path";
import { test, expect } from "./fixtures/app";
import { FIXTURE_FILE } from "./fixtures/helpers";

for (const view of ["Grid view", "List view"]) {
  test(`passes the original file to Electron when dragging from ${view}`, async ({
    app,
    ready,
  }) => {
    // Capture what Meguri passes to Electron without opening a native drag
    // session that would need a second application to finish it.
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.startDrag = ({ files, icon }) => {
        Reflect.set(contents, "testNativeDrag", {
          files,
          hasIcon: typeof icon === "string" ? !!icon : !icon.isEmpty(),
        });
      };
    });

    await ready.getByRole("button", { name: view, exact: true }).click();
    await ready.getByText(FIXTURE_FILE, { exact: true }).hover();
    const handle = ready.getByTitle("Drag to another app");
    await expect(handle).toHaveAttribute("draggable", "true");
    const dataTransfer = await ready.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent("dragstart", { dataTransfer });

    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          Reflect.get(
            BrowserWindow.getAllWindows()[0].webContents,
            "testNativeDrag",
          ) as unknown,
        ),
      )
      .toEqual({
        files: [path.resolve("e2e/fixtures/media", FIXTURE_FILE)],
        hasIcon: true,
      });
    // The parent must not also start an internal collection drag.
    expect(await dataTransfer.evaluate((dt) => dt.types)).toEqual([]);
  });
}
