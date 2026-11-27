import { test, expect } from "./fixtures/app";
import { FIXTURE_FILE } from "./fixtures/helpers";

test.describe("Workspace", () => {
  test("switches to All workspace and back", async ({ ready }) => {
    // Scoped to the rail: the kind filter has an "All" button too.
    const rail = ready.locator('[data-slot="workspace-rail"]');
    await rail.getByRole("button", { name: "All" }).click();
    await expect(rail.getByRole("button", { name: "All" })).toHaveClass(
      /bg-primary/,
    );
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();

    await rail.getByRole("button", { name: "media" }).click();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("shows workspace path in header", async ({ ready }) => {
    await expect(ready.getByText(/e2e\/fixtures\/media/)).toBeVisible();
  });
});
