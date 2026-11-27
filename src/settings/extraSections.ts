import { createContext, useContext, type ComponentType } from "react";
import type { Lang } from "@/i18n/I18nProvider";

/** A settings tab an app built on Meguri adds after Meguri's own (#475). */
export interface SettingsSection {
  /** Unique among the app's sections; also names the tab's DOM ids. */
  id: string;
  /** The tab's label. The app's own strings are not in Meguri's catalogs. */
  label: (lang: Lang) => string;
  /** The tab's contents, rendered inside the settings modal's panel. */
  Component: ComponentType;
}

const ExtraSettingsSections = createContext<readonly SettingsSection[]>([]);

export const ExtraSettingsSectionsProvider = ExtraSettingsSections.Provider;

export function useExtraSettingsSections(): readonly SettingsSection[] {
  return useContext(ExtraSettingsSections);
}
