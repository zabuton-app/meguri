const OPEN_COMMAND_MENU = "meguri:open-command-menu";
const OPEN_SHORTCUTS = "meguri:open-shortcuts";

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
