import { test, expect } from "./fixtures/app";
import { closeTopDialog, openSettings, statusBar } from "./fixtures/helpers";

test.describe("Pet", () => {
  test("stands on the floor above the status bar", async ({ ready }) => {
    const pet = ready.getByRole("button", { name: "Zabuton pet" });
    await expect(pet).toBeVisible();
    const box = (await pet.boundingBox())!;
    const bar = (await statusBar(ready).boundingBox())!;
    expect(Math.abs(box.y + box.height - bar.y)).toBeLessThanOrEqual(1);
  });

  test("opens Discover on a double-click", async ({ ready }) => {
    await ready.getByRole("button", { name: "Zabuton pet" }).dblclick();
    await expect(ready).toHaveURL(/#\/discover/);
  });

  test("falls back to the floor after being dragged up", async ({ ready }) => {
    const pet = ready.getByRole("button", { name: "Zabuton pet" });
    const start = (await pet.boundingBox())!;
    await ready.mouse.move(start.x + 20, start.y + 20);
    await ready.mouse.down();
    await ready.mouse.move(start.x + 220, start.y - 300, { steps: 5 });
    const held = (await pet.boundingBox())!;
    expect(held.y).toBeLessThan(start.y - 200);
    await ready.mouse.up();
    await expect
      .poll(async () => Math.round((await pet.boundingBox())!.y))
      .toBe(Math.round(start.y));
    expect((await pet.boundingBox())!.x).toBeGreaterThan(start.x + 100);
  });

  test("is put away from its menu and brought back in Settings", async ({
    ready,
  }) => {
    const pet = ready.getByRole("button", { name: "Zabuton pet" });
    await pet.click({ button: "right" });
    await ready.getByRole("menuitem", { name: "Put away" }).click();
    await expect(pet).toHaveCount(0);

    const dialog = await openSettings(ready);
    await dialog.getByRole("switch", { name: "Pet" }).click();
    await closeTopDialog(ready);
    await expect(pet).toBeVisible();
  });
});
