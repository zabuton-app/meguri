// Regression tests for the I18nProvider: default language, {param} interpolation, and switching.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider, useI18n } from "@/i18n/I18nProvider";
import { en } from "@/i18n/locales/en";
import { ja } from "@/i18n/locales/ja";
import { appName } from "@/lib/appName";

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
);

describe("I18nProvider", () => {
  it("defaults to English when nothing is persisted", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.lang).toBe("en");
    expect(result.current.t("common.ok")).toBe(en["common.ok"]);
  });

  it("interpolates {param} placeholders", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    const template = en["home.initError"];
    if (typeof template !== "string") throw new Error("expected one form");
    expect(result.current.t("home.initError", { msg: "boom" })).toBe(
      template.replace("{msg}", "boom"),
    );
  });

  it("leaves a placeholder intact when its param is missing", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t("home.initError")).toContain("{msg}");
  });

  it("fills {app} with the app's name, without a param", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t("tour.welcomeTitle")).toBe("Welcome to Meguri");
    vi.mocked(appName).mockReturnValueOnce("Other App");
    expect(result.current.t("tour.welcomeTitle")).toBe("Welcome to Other App");
  });

  it("switches catalog and persists the choice on setLang", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLang("ja"));
    expect(result.current.lang).toBe("ja");
    expect(result.current.t("common.ok")).toBe(ja["common.ok"]);
    expect(localStorage.getItem("meguri.lang")).toBe("ja");
  });

  it("picks the plural form for {count} and writes it for the language", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t("tags.merged", { count: 1 })).toBe("Merged 1 tag");
    expect(result.current.t("tags.merged", { count: 1200 })).toBe(
      "Merged 1,200 tags",
    );
    act(() => result.current.setLang("fr"));
    // French counts 0 as one, and groups thousands with a narrow space.
    expect(result.current.t("tags.merged", { count: 0 })).toBe(
      "0 tag fusionné",
    );
    expect(result.current.t("tags.merged", { count: 1200 })).toBe(
      `${new Intl.NumberFormat("fr").format(1200)} tags fusionnés`,
    );
  });

  it("takes the other form when the count is not a number", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t("statusbar.shown", { count: "1,000+" })).toBe(
      "1,000+ shown",
    );
    expect(result.current.t("timeline.count", { count: "many" })).toBe(
      "many files",
    );
  });
});

describe("I18nProvider OS language on first launch (#505)", () => {
  const originalLanguages = Object.getOwnPropertyDescriptor(
    navigator,
    "languages",
  );
  const originalLanguage = Object.getOwnPropertyDescriptor(
    navigator,
    "language",
  );

  const setOsLanguages = (languages: string[]): void => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: languages,
    });
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: languages[0] ?? "",
    });
  };

  const restoreOsLanguages = (): void => {
    if (originalLanguages) {
      Object.defineProperty(navigator, "languages", originalLanguages);
    } else {
      delete (navigator as unknown as Record<string, unknown>).languages;
    }
    if (originalLanguage) {
      Object.defineProperty(navigator, "language", originalLanguage);
    } else {
      delete (navigator as unknown as Record<string, unknown>).language;
    }
  };

  it("starts in a supported OS language when nothing is stored", () => {
    setOsLanguages(["ja-JP"]);
    try {
      const { result } = renderHook(() => useI18n(), { wrapper });
      expect(result.current.lang).toBe("ja");
      expect(result.current.t("common.ok")).toBe(ja["common.ok"]);
    } finally {
      restoreOsLanguages();
    }
  });

  it("maps a regional tag to its base language", () => {
    setOsLanguages(["fr-CA"]);
    try {
      const { result } = renderHook(() => useI18n(), { wrapper });
      expect(result.current.lang).toBe("fr");
    } finally {
      restoreOsLanguages();
    }
  });

  it("takes the first supported tag of the OS list", () => {
    setOsLanguages(["de-DE", "ko-KR"]);
    try {
      const { result } = renderHook(() => useI18n(), { wrapper });
      expect(result.current.lang).toBe("ko");
    } finally {
      restoreOsLanguages();
    }
  });

  it("keeps a language picked in Settings winning over the OS language", () => {
    localStorage.setItem("meguri.lang", "es");
    setOsLanguages(["ja-JP"]);
    try {
      const { result } = renderHook(() => useI18n(), { wrapper });
      expect(result.current.lang).toBe("es");
    } finally {
      restoreOsLanguages();
    }
  });

  it.each([
    ["zh-TW", "Traditional Chinese"],
    ["zh-HK", "Traditional Chinese (Hong Kong)"],
    ["de-DE", "an unsupported language"],
  ])("falls back to English for %s (%s)", (tag) => {
    setOsLanguages([tag]);
    try {
      const { result } = renderHook(() => useI18n(), { wrapper });
      expect(result.current.lang).toBe("en");
    } finally {
      restoreOsLanguages();
    }
  });

  it("does not store the detected language", () => {
    setOsLanguages(["es-ES"]);
    try {
      const { result } = renderHook(() => useI18n(), { wrapper });
      expect(result.current.lang).toBe("es");
      expect(localStorage.getItem("meguri.lang")).toBeNull();
    } finally {
      restoreOsLanguages();
    }
  });
});
