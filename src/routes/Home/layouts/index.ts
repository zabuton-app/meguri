// The registry of Home layouts. To add one: a component taking
// HomeLayoutProps (built from ../shelfParts), an id in ./ids.ts, a label key
// in every locale, and an entry here. Settings offers the choice as soon as
// there is more than one.
import type { ComponentType } from "react";
import type { TranslationKey } from "@/i18n/locales/ja";
import { DEFAULT_HOME_LAYOUT, type HomeLayoutId } from "./ids";
import type { HomeLayoutProps } from "./types";
import { TodayPickLayout } from "./TodayPickLayout";

export interface HomeLayout {
  id: HomeLayoutId;
  /** Its name in Settings. */
  labelKey: TranslationKey;
  Component: ComponentType<HomeLayoutProps>;
}

export const HOME_LAYOUTS: readonly HomeLayout[] = [
  {
    id: "today-pick",
    labelKey: "home.layoutTodayPick",
    Component: TodayPickLayout,
  },
];

export function homeLayoutFor(id: HomeLayoutId): HomeLayout {
  return (
    HOME_LAYOUTS.find((l) => l.id === id) ??
    HOME_LAYOUTS.find((l) => l.id === DEFAULT_HOME_LAYOUT)!
  );
}

export { DEFAULT_HOME_LAYOUT, HOME_LAYOUT_IDS, isHomeLayoutId } from "./ids";
export type { HomeLayoutId } from "./ids";
export type { HomeLayoutProps } from "./types";
