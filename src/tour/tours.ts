// Guided tours, defined as data. A step points at the element carrying
// `data-tour="<target>"` and names the i18n keys for what the pet says there.
//
// Adding a feature tour: append it to FEATURE_TOURS, put the `data-tour`
// attributes on its targets, and add the strings to every locale. It then runs
// once for everyone who has already been through (or skipped) the first-launch
// tour; a new user is marked as having seen it when the first-launch tour ends.
import type { TranslationKey } from "@/i18n/locales/ja";

export interface TourStep {
  /**
   * The `data-tour` value of the element to highlight. Without one the step
   * is shown in the middle of the screen; with one whose element is not on
   * screen when the tour starts (an empty library, the pet put away), the
   * step is left out.
   */
  target?: string;
  title: TranslationKey;
  body: TranslationKey;
  /** A control the bubble shows under the text. */
  picker?: "language";
}

export interface Tour {
  /** Stable id stored in the seen list: never rename a shipped tour. */
  id: string;
  steps: readonly TourStep[];
}

export const FIRST_LAUNCH_TOUR_ID = "first-launch";

export const FIRST_LAUNCH_TOUR: Tour = {
  id: FIRST_LAUNCH_TOUR_ID,
  steps: [
    // The language comes first, so the rest of the tour is in the one chosen.
    {
      title: "tour.languageTitle",
      body: "tour.languageBody",
      picker: "language",
    },
    { title: "tour.welcomeTitle", body: "tour.welcomeBody" },
    {
      target: "add-workspace",
      title: "tour.addWorkspaceTitle",
      body: "tour.addWorkspaceBody",
    },
    {
      target: "collections",
      title: "tour.collectionsTitle",
      body: "tour.collectionsBody",
    },
    { target: "search", title: "tour.searchTitle", body: "tour.searchBody" },
    { target: "view-mode", title: "tour.viewTitle", body: "tour.viewBody" },
    {
      target: "discover",
      title: "tour.discoverTitle",
      body: "tour.discoverBody",
    },
    { target: "pet", title: "tour.petTitle", body: "tour.petBody" },
    {
      target: "command-menu",
      title: "tour.commandTitle",
      body: "tour.commandBody",
    },
    {
      target: "settings",
      title: "tour.settingsTitle",
      body: "tour.settingsBody",
    },
    { title: "tour.doneTitle", body: "tour.doneBody" },
  ],
};

/** Tours for features added in a release, oldest first. */
export const FEATURE_TOURS: readonly Tour[] = [];

const ALL_TOURS: readonly Tour[] = [FIRST_LAUNCH_TOUR, ...FEATURE_TOURS];

export function findTour(id: string): Tour | undefined {
  return ALL_TOURS.find((tour) => tour.id === id);
}

export function tourSelector(target: string): string {
  return `[data-tour="${target}"]`;
}
