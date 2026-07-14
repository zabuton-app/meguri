import { test, expect } from "./fixtures/app";
import { FIXTURE_FILE } from "./fixtures/helpers";

test.describe("Workspace", () => {
  test("switches to All workspace and back", async ({ ready }) => {
    await ready.getByRole("button", { name: "All" }).click();
    await expect(ready.getByRole("button", { name: "All" })).toHaveClass(
      /bg-primary/,
    );
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();

    await ready.getByRole("button", { name: "media" }).click();
    await expect(ready.getByText(FIXTURE_FILE)).toBeVisible();
  });

  test("shows workspace path in header", async ({ ready }) => {
    await expect(ready.getByText(/e2e\/fixtures\/media/)).toBeVisible();
  });
});
