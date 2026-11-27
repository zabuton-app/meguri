// The main window's buttons and state, for the custom title bar the renderer
// draws in place of the native one (#578). Main owns the window, so the
// renderer asks here and hears back through the window:state event.
import {
  systemPreferences,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
} from "electron";
import { handle } from "../core/ipcHandler.js";
import type { WindowState } from "../../shared/ipc/channels.js";
import { TITLE_BAR_HEIGHT, TRAFFIC_LIGHTS } from "../../shared/titleBar.js";
import type { IpcContext } from "./context.js";

/**
 * The window options that hand the title bar to the renderer (TitleBar.tsx).
 * Without a titleBarOverlay, Windows and Linux show no window buttons, so the
 * title bar draws its own. macOS keeps its traffic lights: they start at the
 * left end of the bar, and the renderer moves them to where it leaves room
 * for them (window_set_button_position), which the zoom and the user's choice
 * of side change.
 */
export function titleBarOptions(): BrowserWindowConstructorOptions {
  return {
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? {
          trafficLightPosition: {
            x: 14,
            y: (TITLE_BAR_HEIGHT - TRAFFIC_LIGHTS.height) / 2,
          },
        }
      : {}),
  };
}

export function windowState(win: BrowserWindow): WindowState {
  return { maximized: win.isMaximized(), fullScreen: win.isFullScreen() };
}

/** Send `win`'s state to the renderer whenever it changes. */
export function forwardWindowState(
  win: BrowserWindow,
  emit: IpcContext["emit"],
): void {
  const send = () => emit("window:state", windowState(win));
  win.on("maximize", send);
  win.on("unmaximize", send);
  win.on("enter-full-screen", send);
  win.on("leave-full-screen", send);
}

function toggleMaximize(win: BrowserWindow): void {
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
}

export function registerWindowHandlers(ctx: IpcContext): void {
  const win = () => {
    const w = ctx.mainWindow();
    return w && !w.isDestroyed() ? w : null;
  };

  // Goes through close() so the tray-hide behavior in the "close" handler
  // applies: the title bar's close button and Esc on the bare list screen.
  handle("window_close", () => {
    win()?.close();
  });

  handle("window_minimize", () => {
    win()?.minimize();
  });

  handle("window_toggle_maximize", () => {
    const w = win();
    if (w) toggleMaximize(w);
  });

  handle("window_state", () => {
    const w = win();
    return w ? windowState(w) : { maximized: false, fullScreen: false };
  });

  handle("window_set_button_position", ({ x, y }) => {
    const w = win();
    if (w && process.platform === "darwin") w.setWindowButtonPosition({ x, y });
  });

  // The user can turn the window buttons off (Settings > Appearance); on
  // macOS that hides the traffic lights, which only main can do.
  handle("window_set_button_visibility", (visible) => {
    const w = win();
    if (w && process.platform === "darwin")
      w.setWindowButtonVisibility(visible);
  });

  // On Windows and Linux a double click on the drag region is the OS's: the
  // region is the window's caption there and the page never sees the click.
  // macOS hands it to the page, so this applies the system setting ("Double-
  // click a window's title bar to"): an unset value means zoom, the default.
  handle("window_title_bar_double_click", () => {
    const w = win();
    if (!w || process.platform !== "darwin") return;
    const action = systemPreferences.getUserDefault(
      "AppleActionOnDoubleClick",
      "string",
    );
    if (action === "Minimize") w.minimize();
    else if (action !== "None") toggleMaximize(w);
  });
}
