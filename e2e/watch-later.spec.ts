import { test, expect } from "./fixtures/app";
import {
  closeTopDialog,
  fileCard,
  openFileDetail,
  waitForIndexedMedia,
  FIXTURE_FILE,
} from "./fixtures/helpers";

// End-to-end cover for the quickstart scenarios: the built-in list exists from
// first launch, entries go in from the per-item toggle, and playing a file takes
// it back off the list. The fixture is an image, and images record a play when
// their detail view opens, so viewing one here exercises the removal path.
test.describe("Watch Later", () => {
  const railButton = (page: Parameters<typeof fileCard>[0]) =>
    page.getByRole("button", { name: "Watch Later", exact: true });

  test("exists on first launch without the user creating anything", async ({
    ready,
  }) => {
    await expect(railButton(ready)).toBeVisible();
  });

  test("has no delete affordance, unlike user collections", async ({
    ready,
  }) => {
    await ready.getByRole("button", { name: "Create user collection" }).click();
    const dialog = ready.getByRole("dialog");
    await dialog.getByPlaceholder("Collection name").fill("Deletable");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(
      ready.getByRole("button", { name: "Deletable" }),
    ).toBeVisible();

    // The user collection brings a delete button; the built-in one must not, so
    // exactly one exists on the rail.
    await expect(ready.getByTitle("Delete collection")).toHaveCount(1);
  });

  test("collects a file from the grid toggle, then drops it once played", async ({
    ready,
  }) => {
    await waitForIndexedMedia(ready);

    // Empty until something is added, and it explains itself rather than
    // telling the user to run a scan (which would never populate this list).
    await railButton(ready).click();
    await expect(ready.getByText("Watch Later is empty.")).toBeVisible();
    await expect(ready.getByText(/Run "Scan"/)).toHaveCount(0);

    // Add from the workspace grid.
    await ready.getByRole("button", { name: "media" }).click();
    await waitForIndexedMedia(ready);
    await fileCard(ready)
      .getByRole("button", { name: "Add to Watch Later" })
      .click();
    await expect(ready.getByText("Added to Watch Later")).toBeVisible();

    // The file is now listed under Watch Later.
    await railButton(ready).click();
    await waitForIndexedMedia(ready);

    // Viewing the image records a play (images have no player, so a view is the
    // play), which is what takes it off the list.
    await openFileDetail(ready);
    await closeTopDialog(ready);
    await expect(ready.getByText("Watch Later is empty.")).toBeVisible();

    // The file itself is untouched — still present in its own workspace.
    await ready.getByRole("button", { name: "media" }).click();
    await expect(ready.getByText(FIXTURE_FILE).first()).toBeVisible();
  });

  test("keeps prev/next usable while viewing from the list", async ({
    ready,
  }) => {
    // The file leaves Watch Later the moment it is played. If that removal were
    // broadcast while the detail view is up, the open file would drop out of the
    // navigation order and prev/next would dead-end mid-session.
    await waitForIndexedMedia(ready);
    await fileCard(ready)
      .getByRole("button", { name: "Add to Watch Later" })
      .click();
    await expect(ready.getByText("Added to Watch Later")).toBeVisible();

    await railButton(ready).click();
    await waitForIndexedMedia(ready);
    const detail = await openFileDetail(ready);

    // Give the removal (and any refetch it might trigger) time to land.
    await ready.waitForTimeout(500);
    await expect(
      detail.getByRole("heading", { name: FIXTURE_FILE }),
    ).toBeVisible();
    await expect(ready.getByText("Watch Later is empty.")).toHaveCount(0);
  });

  test("offers no rename affordance in the header", async ({ ready }) => {
    await railButton(ready).click();
    // User collections get a pencil in the header; the built-in one must not,
    // since the main process rejects the rename and it would look like it worked.
    await expect(ready.getByLabel("Edit collection")).toHaveCount(0);
  });

  test("offers the toggle in list and table views too", async ({ ready }) => {
    await waitForIndexedMedia(ready);

    for (const view of ["List view", "Table view"] as const) {
      await ready.getByRole("button", { name: view }).click();
      await expect(
        ready.getByRole("button", { name: "Add to Watch Later" }).first(),
      ).toBeVisible();
    }

    // Adding from the table view lands in the same list.
    await ready
      .getByRole("button", { name: "Add to Watch Later" })
      .first()
      .click();
    await expect(ready.getByText("Added to Watch Later")).toBeVisible();
    await railButton(ready).click();
    await waitForIndexedMedia(ready);
  });

  test("offers removal for a file already collected", async ({ ready }) => {
    await waitForIndexedMedia(ready);
    await fileCard(ready)
      .getByRole("button", { name: "Add to Watch Later" })
      .click();
    await expect(ready.getByText("Added to Watch Later")).toBeVisible();

    await fileCard(ready)
      .getByRole("button", { name: "Remove from Watch Later" })
      .click();
    await expect(ready.getByText("Removed from Watch Later")).toBeVisible();
  });
});
