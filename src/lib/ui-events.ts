const OPEN_COMMAND_MENU = "meguri:open-command-menu";
const OPEN_SHORTCUTS = "meguri:open-shortcuts";
const APPLY_TAG_FILTER = "meguri:apply-tag-filter";

export function openCommandMenu() {
  window.dispatchEvent(new Event(OPEN_COMMAND_MENU));
}

export function openShortcuts() {
  window.dispatchEvent(new Event(OPEN_SHORTCUTS));
}

export function onOpenCommandMenu(listener: () => void) {
  window.addEventListener(OPEN_COMMAND_MENU, listener);
  return () => window.removeEventListener(OPEN_COMMAND_MENU, listener);
}

export function onOpenShortcuts(listener: () => void) {
  window.addEventListener(OPEN_SHORTCUTS, listener);
  return () => window.removeEventListener(OPEN_SHORTCUTS, listener);
}

/**
 * Ask the library — which stays mounted underneath every child-route modal — to
 * AND these search-box tokens (`tag:beach`, `meta:4k`) into its query. Home owns
 * `filter` as local state, so a modal cannot set it directly.
 */
export function applyTagFilter(tokens: string[]) {
  window.dispatchEvent(
    new CustomEvent<string[]>(APPLY_TAG_FILTER, { detail: tokens }),
  );
}

export function onApplyTagFilter(listener: (tokens: string[]) => void) {
  const handler = (e: Event) => listener((e as CustomEvent<string[]>).detail);
  window.addEventListener(APPLY_TAG_FILTER, handler);
  return () => window.removeEventListener(APPLY_TAG_FILTER, handler);
}
