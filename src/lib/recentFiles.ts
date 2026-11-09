import {
  RECENT_BASES,
  RECENT_PERIODS,
  type RecentBasis,
  type RecentFiles,
} from "@shared/recentFiles";
import type { TFunc } from "@/i18n/I18nProvider";

const VIEW_KEY = "meguri.recentFiles.view";
export const RECENT_BASIS_KEY = "meguri.recentFiles.basis";

export function recentBasis(raw: string | null): RecentBasis {
  return raw === "created" ? "created" : "added";
}

export function loadRecentView(): RecentFiles | null {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(VIEW_KEY) ?? "null",
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("basis" in parsed) ||
      !("period" in parsed)
    )
      return null;
    if (
      !RECENT_PERIODS.some((p) => p === parsed.period) ||
      !RECENT_BASES.some((b) => b === parsed.basis)
    )
      return null;
    return parsed as RecentFiles;
  } catch {
    return null;
  }
}

export function saveRecentView(value: RecentFiles | undefined): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(value ?? null));
  } catch {
    /* storage can be unavailable */
  }
}

export function describeRecentFiles(t: TFunc, value: RecentFiles): string {
  return `${t("recent.title")}: ${t(`recent.${value.period}`)} / ${t(value.basis === "added" ? "recent.added" : "recent.created")}`;
}
