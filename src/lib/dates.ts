// Dates in the UI follow the APP language, not the OS locale: the rest of the
// interface is translated, so a date spelled in the OS locale is the one place
// the app can disagree with itself. The timeline and the heatmap already pass
// the language they format with; these are the calls that did not.
import type { Lang } from "@/i18n/I18nProvider";

/** A date and time in the app language ("October 6, 2026, 3:04 PM"). */
export function formatDateTime(date: Date, lang: Lang): string {
  return date.toLocaleString(lang);
}

/** A date in the app language ("October 6, 2026"). */
export function formatDate(date: Date, lang: Lang): string {
  return date.toLocaleDateString(lang);
}
