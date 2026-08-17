import { test, expect } from "./fixtures/app";
import { closeTopDialog, openSettings } from "./fixtures/helpers";

test.describe("Emoji style", () => {
  test("defaults to native with the fallback sentinel in the stack", async ({
    ready,
  }) => {
    await expect(ready.locator("html")).toHaveAttribute(
      "data-emoji-style",
      "native",
    );
    const fontFamily = await ready.evaluate(
      () => getComputedStyle(document.body).fontFamily,
    );
    expect(fontFamily).toContain("meguri-emoji-none");
  });

  test("switches the app-wide emoji font and persists the pref", async ({
    ready,
  }) => {
    const dialog = await openSettings(ready);
    await dialog
      .locator("section", { hasText: "Emoji style" })
      .getByRole("combobox")
      .click();
    await ready.getByRole("option", { name: "Twemoji" }).click();

    await expect(ready.locator("html")).toHaveAttribute(
      "data-emoji-style",
      "twemoji",
    );
    const fontFamily = await ready.evaluate(
      () => getComputedStyle(document.body).fontFamily,
    );
    expect(fontFamily).toContain("Meguri Twemoji");

    const stored = await ready.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem("meguri.prefs") ?? "{}") as {
            emojiStyle?: string;
          }
        ).emojiStyle,
    );
    expect(stored).toBe("twemoji");
    await closeTopDialog(ready);
  });

  test("renders picker glyphs in the active style", async ({ ready }) => {
    // Activate an alternative style first, via the real settings UI.
    const settings = await openSettings(ready);
    await settings
      .locator("section", { hasText: "Emoji style" })
      .getByRole("combobox")
      .click();
    await ready.getByRole("option", { name: "Twemoji" }).click();
    await closeTopDialog(ready);

    // The picker lives inside the collection create/edit dialog.
    await ready.getByRole("button", { name: "Create user collection" }).click();
    const createDialog = ready.getByRole("dialog");
    await createDialog.getByRole("button", { name: "Choose emoji" }).click();

    // The override <style> is injected asynchronously after the custom element
    // upgrades. Assert on the COMPUTED font of an actual glyph span: emoji-mart
    // sets font-family inline there, so this only passes if the injected
    // !important rule genuinely wins (not merely if the <style> tag exists).
    await expect
      .poll(() =>
        ready.evaluate(() => {
          const span = document
            .querySelector("em-emoji-picker")
            ?.shadowRoot?.querySelector(".emoji-mart-emoji span");
          return span ? getComputedStyle(span).fontFamily : null;
        }),
      )
      .toContain("Meguri Twemoji");
  });
});
