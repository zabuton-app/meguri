// The Home layouts a user can choose between (Settings > General). Only the
// ids live here so the preferences layer can validate a stored choice without
// pulling the layout components in; the registry is in ./index.ts.
export const HOME_LAYOUT_IDS = ["today-pick"] as const;
export type HomeLayoutId = (typeof HOME_LAYOUT_IDS)[number];
export const DEFAULT_HOME_LAYOUT: HomeLayoutId = "today-pick";

export function isHomeLayoutId(v: unknown): v is HomeLayoutId {
  return HOME_LAYOUT_IDS.includes(v as HomeLayoutId);
}
