// Regression tests for the I18nProvider: default language, {param} interpolation, and switching.
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider, useI18n } from "@/i18n/I18nProvider";
import { en } from "@/i18n/locales/en";
import { ja } from "@/i18n/locales/ja";

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
    const expected = en["home.initError"].replace("{msg}", "boom");
    expect(result.current.t("home.initError", { msg: "boom" })).toBe(expected);
  });

  it("leaves a placeholder intact when its param is missing", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t("home.initError")).toContain("{msg}");
  });

  it("switches catalog and persists the choice on setLang", () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLang("ja"));
    expect(result.current.lang).toBe("ja");
    expect(result.current.t("common.ok")).toBe(ja["common.ok"]);
    expect(localStorage.getItem("meguri.lang")).toBe("ja");
  });
});
