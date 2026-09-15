import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_LAYOUT,
  HOME_LAYOUTS,
  HOME_LAYOUT_IDS,
  homeLayoutFor,
  isHomeLayoutId,
} from "@/routes/Home/layouts";
import { ja } from "@/i18n/locales/ja";

describe("Home layouts", () => {
  it("registers every id exactly once, with a label", () => {
    expect(HOME_LAYOUTS.map((l) => l.id)).toEqual([...HOME_LAYOUT_IDS]);
    for (const layout of HOME_LAYOUTS) expect(ja[layout.labelKey]).toBeTruthy();
  });

  it("falls back to the default for an unknown id", () => {
    expect(isHomeLayoutId("today-pick")).toBe(true);
    expect(isHomeLayoutId("nope")).toBe(false);
    expect(homeLayoutFor(DEFAULT_HOME_LAYOUT).id).toBe(DEFAULT_HOME_LAYOUT);
    // A stored id from a layout since removed lands on the default too.
    expect(homeLayoutFor("gone" as never).id).toBe(DEFAULT_HOME_LAYOUT);
  });
});
