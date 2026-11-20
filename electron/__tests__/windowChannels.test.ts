// The window channels behind the custom title bar (#578), through their real
// handlers, against a stand-in for the BrowserWindow.
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>();
const doubleClickAction = vi.fn<() => string>(() => "");
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, raw: unknown) => unknown) =>
      handlers.set(channel, fn),
  },
  systemPreferences: { getUserDefault: () => doubleClickAction() },
}));

const { registerWindowHandlers, forwardWindowState, titleBarOptions } =
  await import("../ipc/window.js");
const { setRendererIndex } = await import("../core/appUrl.js");
type IpcContext = import("../ipc/context.js").IpcContext;
type BrowserWindow = import("electron").BrowserWindow;

const rendererIndex = path.join(os.tmpdir(), "meguri-app", "index.html");
setRendererIndex(rendererIndex);
const fromApp = { senderFrame: { url: pathToFileURL(rendererIndex).href } };
const invoke = (channel: string) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn(fromApp, undefined);
};

class FakeWindow extends EventEmitter {
  maximized = false;
  fullScreen = false;
  minimized = false;
  closed = false;
  destroyed = false;
  isMaximized = () => this.maximized;
  isFullScreen = () => this.fullScreen;
  isDestroyed = () => this.destroyed;
  maximize = () => (this.maximized = true);
  unmaximize = () => (this.maximized = false);
  minimize = () => (this.minimized = true);
  close = () => (this.closed = true);
  buttonPosition: unknown = null;
  setWindowButtonPosition = (p: unknown) => (this.buttonPosition = p);
  buttonsVisible = true;
  setWindowButtonVisibility = (v: boolean) => (this.buttonsVisible = v);
}

const platform = process.platform;
function onPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

let win: FakeWindow | null;

beforeEach(() => {
  handlers.clear();
  doubleClickAction.mockReturnValue("");
  win = new FakeWindow();
  registerWindowHandlers({
    mainWindow: () => win as unknown as BrowserWindow,
  } as unknown as IpcContext);
});

afterEach(() => onPlatform(platform));

describe("window channels", () => {
  it("minimizes, toggles maximize and closes the window", async () => {
    await invoke("window_minimize");
    expect(win!.minimized).toBe(true);
    await invoke("window_toggle_maximize");
    expect(win!.maximized).toBe(true);
    await invoke("window_toggle_maximize");
    expect(win!.maximized).toBe(false);
    await invoke("window_close");
    expect(win!.closed).toBe(true);
  });

  it("answers the window's state, and a resting state without a window", async () => {
    win!.maximized = true;
    expect(await invoke("window_state")).toEqual({
      maximized: true,
      fullScreen: false,
    });
    win!.destroyed = true;
    expect(await invoke("window_state")).toEqual({
      maximized: false,
      fullScreen: false,
    });
    win = null;
    await expect(invoke("window_minimize")).resolves.toBeUndefined();
  });

  it("forwards each change of the window's state", () => {
    const sent: unknown[] = [];
    forwardWindowState(win as unknown as BrowserWindow, (_channel, payload) =>
      sent.push(payload),
    );
    win!.maximized = true;
    win!.emit("maximize");
    win!.fullScreen = true;
    win!.emit("enter-full-screen");
    expect(sent).toEqual([
      { maximized: true, fullScreen: false },
      { maximized: true, fullScreen: true },
    ]);
  });
});

describe("a double click on the title bar", () => {
  it("follows the macOS setting, zooming when it is unset", async () => {
    onPlatform("darwin");
    await invoke("window_title_bar_double_click");
    expect(win!.maximized).toBe(true);
    doubleClickAction.mockReturnValue("Minimize");
    await invoke("window_title_bar_double_click");
    expect(win!.minimized).toBe(true);
    doubleClickAction.mockReturnValue("None");
    await invoke("window_title_bar_double_click");
    expect(win!.maximized).toBe(true);
  });

  it("is left to the OS on Windows and Linux", async () => {
    onPlatform("linux");
    await invoke("window_title_bar_double_click");
    expect(win!.maximized).toBe(false);
  });
});

describe("placing the traffic lights", () => {
  it("moves them on macOS", async () => {
    onPlatform("darwin");
    await handlers.get("window_set_button_position")!(fromApp, {
      x: 90,
      y: 17,
    });
    expect(win!.buttonPosition).toEqual({ x: 90, y: 17 });
  });

  it("does nothing elsewhere, where the app draws its own buttons", async () => {
    onPlatform("win32");
    await handlers.get("window_set_button_position")!(fromApp, {
      x: 90,
      y: 17,
    });
    expect(win!.buttonPosition).toBeNull();
  });

  it("refuses a position outside the window's coordinates", async () => {
    onPlatform("darwin");
    await expect(
      handlers.get("window_set_button_position")!(fromApp, { x: -1, y: 0.5 }),
    ).rejects.toThrow(/Invalid IPC payload/);
  });
});

describe("hiding the traffic lights", () => {
  it("hides and shows them on macOS", async () => {
    onPlatform("darwin");
    const set = handlers.get("window_set_button_visibility")!;
    await set(fromApp, false);
    expect(win!.buttonsVisible).toBe(false);
    await set(fromApp, true);
    expect(win!.buttonsVisible).toBe(true);
  });

  it("does nothing elsewhere", async () => {
    onPlatform("linux");
    await handlers.get("window_set_button_visibility")!(fromApp, false);
    expect(win!.buttonsVisible).toBe(true);
  });
});

describe("titleBarOptions", () => {
  it("hides the title bar, and places the traffic lights only on macOS", () => {
    onPlatform("win32");
    expect(titleBarOptions()).toEqual({ titleBarStyle: "hidden" });
    onPlatform("darwin");
    expect(titleBarOptions()).toMatchObject({
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 14, y: 13 },
    });
  });
});
