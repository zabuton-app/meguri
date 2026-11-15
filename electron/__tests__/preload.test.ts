// The preload's whitelist takes an app's own channels from main (#474).
import { describe, expect, it, vi } from "vitest";
import { extraChannelArgs } from "../../shared/ipc/channelNames.js";

const invoke = vi.fn(() => Promise.resolve("ok"));
const on = vi.fn();
let api: {
  invoke: (channel: string, args?: unknown) => Promise<unknown>;
  on: (channel: string, cb: (payload: unknown) => void) => () => void;
};
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, value: typeof api) => {
      api = value;
    },
  },
  ipcRenderer: { invoke, on, removeListener: vi.fn() },
  webFrame: {},
  webUtils: {},
}));
vi.mock("electron-log/preload", () => ({}));

const argv = process.argv;
process.argv = [
  ...argv,
  ...extraChannelArgs({ invoke: ["myapp_get"], events: ["myapp:changed"] }),
];
await import("../preload.js");
process.argv = argv;

describe("preload whitelist", () => {
  it("lets through Meguri's channels and the extra ones", async () => {
    await expect(api.invoke("app_status")).resolves.toBe("ok");
    await expect(api.invoke("myapp_get", { id: 1 })).resolves.toBe("ok");
    expect(invoke).toHaveBeenLastCalledWith("myapp_get", { id: 1 });
    api.on("scan:done", () => {});
    api.on("myapp:changed", () => {});
    expect(on).toHaveBeenLastCalledWith("myapp:changed", expect.any(Function));
  });

  it("refuses any other channel", async () => {
    invoke.mockClear();
    on.mockClear();
    await expect(api.invoke("myapp_set")).rejects.toThrow(/not allowed/);
    // An extra event channel is not an invoke channel, nor the reverse.
    await expect(api.invoke("myapp:changed")).rejects.toThrow(/not allowed/);
    expect(() => api.on("myapp_get", () => {})).toThrow(/not allowed/);
    expect(invoke).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
  });
});

describe("extraChannelArgs", () => {
  it("passes no channel when there are none", () => {
    expect(extraChannelArgs({ invoke: [], events: [] })).toEqual([
      "--extra-invoke-channels=",
      "--extra-event-channels=",
    ]);
  });

  it("rejects a name the preload would read as something else", () => {
    expect(() => extraChannelArgs({ invoke: ["a,b"], events: [] })).toThrow();
    expect(() => extraChannelArgs({ invoke: [], events: [""] })).toThrow();
  });

  it("rejects a preload-only channel", () => {
    expect(() =>
      extraChannelArgs({ invoke: ["workspace_add_path"], events: [] }),
    ).toThrow(/Preload-only/);
  });
});
