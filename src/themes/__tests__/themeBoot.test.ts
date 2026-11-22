import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInThisContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

// public/theme-boot.js runs before the bundle, so it is tested by running its source.
const source = readFileSync(
  resolve(__dirname, "../../../public/theme-boot.js"),
  "utf8",
);
const runBoot = () => runInThisContext(source);

const html = document.documentElement;

afterEach(() => {
  localStorage.clear();
  html.removeAttribute("data-theme");
  html.removeAttribute("data-boot-fade");
  html.style.backgroundColor = "";
});

function prefs(value: string) {
  localStorage.setItem("meguri.prefs", value);
}

describe("theme-boot.js", () => {
  it("paints the stored theme when the random theme is off", () => {
    localStorage.setItem("meguri.theme", "nord-light");
    localStorage.setItem("meguri.theme.bg", "#eceff4");
    prefs(JSON.stringify({ randomThemeOnStartup: false }));
    runBoot();
    expect(html.dataset.theme).toBe("nord-light");
    expect(html.style.backgroundColor).toBe("#eceff4");
    expect(html.hasAttribute("data-boot-fade")).toBe(false);
  });

  it.each([
    ["#eceff4", "#f4f4f4"],
    ["#2e3440", "#1c1c1c"],
  ])(
    "paints a neutral gray for a previous %s and starts the fade when it is on",
    (previous, gray) => {
      localStorage.setItem("meguri.theme.bg", previous);
      prefs(JSON.stringify({ randomThemeOnStartup: true }));
      runBoot();
      expect(html.style.backgroundColor).toBe(gray);
      expect(html.hasAttribute("data-boot-fade")).toBe(true);
    },
  );

  it("keeps the stored theme when the preferences are broken", () => {
    localStorage.setItem("meguri.theme", "nord-light");
    localStorage.setItem("meguri.theme.bg", "#eceff4");
    prefs("{broken");
    runBoot();
    expect(html.dataset.theme).toBe("nord-light");
    expect(html.style.backgroundColor).toBe("#eceff4");
    expect(html.hasAttribute("data-boot-fade")).toBe(false);
  });
});
