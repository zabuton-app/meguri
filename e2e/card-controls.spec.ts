import { test, expect } from "./fixtures/app";
import { fileCard, waitForIndexedMedia } from "./fixtures/helpers";

// The grid card's toggles sit beside its links rather than inside them
// (no <button> nested in an <a>), layered over the links instead. These cover
// what the unit tests cannot: which element a real click lands on, the
// keyboard path through a card, and the focus ring drawn over the thumbnail.
test.describe("Grid card controls", () => {
  test.beforeEach(async ({ ready }) => {
    await waitForIndexedMedia(ready);
  });

  test("keeps the links and the toggles out of each other's nesting", async ({
    ready,
  }) => {
    const card = fileCard(ready);
    await card.hover();
    await expect(card.getByRole("button", { name: "Select" })).toBeVisible();
    await expect(
      card.locator("a button, a [role='button'], a input"),
    ).toHaveCount(0);
  });

  test("a click on a toggle runs the toggle, not the link", async ({
    ready,
  }) => {
    const card = fileCard(ready);
    await card.hover();
    // Playwright only clicks when the button itself is the hit target, so this
    // also proves the toggle is drawn above the thumbnail link.
    await card.getByRole("button", { name: "Add to favorites" }).click();
    await expect(
      card.getByRole("button", { name: "Remove from favorites" }),
    ).toBeVisible();
    await expect(ready.getByRole("dialog")).toHaveCount(0);
  });

  test("a click on the 'No tags' label falls through to the paused detail", async ({
    ready,
  }) => {
    // The label is under the tag strip, which only lets the chips take the
    // pointer; a click there must reach the file-name link's overlay. Clicked
    // by coordinates: Playwright's own click refuses an element that does not
    // receive the pointer, which is the point here.
    const box = await fileCard(ready)
      .getByText("No tags", { exact: true })
      .boundingBox();
    expect(box).not.toBeNull();
    await ready.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(ready.getByRole("dialog")).toBeVisible();
    await expect(ready).toHaveURL(/autoplay=0/);
  });

  test("Tab walks the thumbnail link, then each toggle, and Enter/Space press the toggle", async ({
    ready,
  }) => {
    const card = fileCard(ready);
    const thumbLink = card.locator("[data-thumb] > a");
    // Reach the link from the keyboard so :focus-visible applies.
    await thumbLink.focus();
    await ready.keyboard.press("Shift+Tab");
    await ready.keyboard.press("Tab");
    await expect(thumbLink).toBeFocused();

    // The ring is drawn on the link's ::after, above the thumbnail image.
    const ring = await thumbLink.evaluate(
      (a) => getComputedStyle(a, "::after").boxShadow,
    );
    expect(ring).not.toBe("none");

    await ready.keyboard.press("Tab");
    await expect(card.getByRole("button", { name: "Select" })).toBeFocused();
    await ready.keyboard.press("Tab");
    const favorite = card.getByRole("button", { name: "Add to favorites" });
    await expect(favorite).toBeFocused();
    await ready.keyboard.press("Enter");
    await expect(
      card.getByRole("button", { name: "Remove from favorites" }),
    ).toBeVisible();

    await ready.keyboard.press("Tab");
    await expect(
      card.getByRole("button", { name: "Add to Watch Later" }),
    ).toBeFocused();
    await ready.keyboard.press("Space");
    await expect(ready.getByText("Added to Watch Later")).toBeVisible();

    // Neither key followed the link.
    await expect(ready.getByRole("dialog")).toHaveCount(0);
  });
});
