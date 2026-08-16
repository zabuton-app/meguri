// Spec-009 favorite/rating effect animations: verify in the real app that the
// decorative overlays fire only at the activated control, restart cleanly, and
// are suppressed under prefers-reduced-motion while state changes remain.
import { expect, test } from "./fixtures/app";
import {
  expectStarRating,
  fileCard,
  openDiscover,
  openFileDetail,
} from "./fixtures/helpers";

const BURST = '[data-testid="fx-burst"]';

test("favorite add bursts at the card heart; remove settles without particles", async ({
  ready,
}) => {
  const card = fileCard(ready);

  await card.getByRole("button", { name: "Add to favorites" }).click();
  await expect(card.locator(BURST)).toBeVisible();
  await expect(card.locator(".fx-pop")).toHaveCount(1);
  await expect(
    card.getByRole("button", { name: "Remove from favorites" }),
  ).toBeVisible();
  // The burst removes itself once the animation finishes.
  await expect(ready.locator(BURST)).toHaveCount(0);

  await card.getByRole("button", { name: "Remove from favorites" }).click();
  await expect(card.locator(".fx-settle")).toHaveCount(1);
  await expect(ready.locator(BURST)).toHaveCount(0);
});

test("effect plays only at the activated control, not on other views of the same file", async ({
  ready,
}) => {
  const dialog = await openFileDetail(ready);

  await dialog.getByRole("button", { name: "Add to favorites" }).click();

  // Exactly one burst on the whole page, and it lives inside the dialog — the
  // grid card behind it updates its heart silently (FR-005).
  await expect(ready.locator(BURST)).toHaveCount(1);
  await expect(dialog.locator(BURST)).toHaveCount(1);
});

test("rapid re-activation restarts the effect instead of stacking overlays", async ({
  ready,
}) => {
  const card = fileCard(ready);
  const heart = card.getByRole("button", { name: /favorites$/ });

  for (let i = 0; i < 5; i += 1) {
    await heart.click();
  }

  expect(await ready.locator(BURST).count()).toBeLessThanOrEqual(1);
  expect(
    await card.locator(".fx-pop, .fx-settle").count(),
  ).toBeLessThanOrEqual(1);
});

test("rating set staggers pops up to the chosen star and bursts there; clear settles", async ({
  ready,
}) => {
  const dialog = await openFileDetail(ready);

  await dialog.getByRole("button", { name: "4 stars" }).click();
  await expect(dialog.locator(".fx-pop")).toHaveCount(4);
  await expect(
    dialog.getByRole("button", { name: "4 stars" }).locator(BURST),
  ).toHaveCount(1);
  await expectStarRating(dialog, 4);

  // Clicking the current value clears the rating: joint settle, no particles.
  await dialog.getByRole("button", { name: "4 stars" }).click();
  await expect(dialog.locator(".fx-settle")).toHaveCount(4);
  await expect(dialog.locator(BURST)).toHaveCount(0);
  await expectStarRating(dialog, 0);
});

test("favorite effect fires in list, table, and discover views too", async ({
  ready,
}) => {
  for (const mode of ["List view", "Table view"] as const) {
    await ready.getByRole("button", { name: mode }).click();
    await ready
      .getByRole("button", { name: "Add to favorites" })
      .first()
      .click();
    await expect(ready.locator(BURST)).toHaveCount(1);
    // Wait for the burst to finish, then toggle back for the next view.
    await expect(ready.locator(BURST)).toHaveCount(0);
    await ready
      .getByRole("button", { name: "Remove from favorites" })
      .first()
      .click();
    await expect(ready.locator(".fx-settle")).toHaveCount(1);
  }

  await ready.getByRole("button", { name: "Grid view" }).click();
  const discover = await openDiscover(ready);
  await discover
    .getByRole("button", { name: "Add to favorites" })
    .first()
    .click();
  await expect(discover.locator(BURST)).toHaveCount(1);
});

test("prefers-reduced-motion suppresses effects while state changes stay visible", async ({
  ready,
}) => {
  await ready.emulateMedia({ reducedMotion: "reduce" });
  const card = fileCard(ready);

  await card.getByRole("button", { name: "Add to favorites" }).click();
  await expect(
    card.getByRole("button", { name: "Remove from favorites" }),
  ).toBeVisible();
  expect(await ready.locator(BURST).count()).toBe(0);
  expect(await ready.locator(".fx-pop").count()).toBe(0);

  const dialog = await openFileDetail(ready);
  await dialog.getByRole("button", { name: "3 stars" }).click();
  await expectStarRating(dialog, 3);
  expect(await ready.locator(BURST).count()).toBe(0);
  expect(await ready.locator(".fx-pop").count()).toBe(0);
});
