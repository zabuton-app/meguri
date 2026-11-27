// handle() answers the app's own page only (#272), and so does an app's
// handler for its extra channels (#495).
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, raw: unknown) => unknown) =>
      handlers.set(channel, fn),
  },
}));

const { handle, handleExtraFor } = await import("../ipcHandler.js");
const { setRendererIndex } = await import("../appUrl.js");

const index = path.join(os.tmpdir(), "meguri-app", "renderer", "index.html");
setRendererIndex(index);

const fn = vi.fn(() => "ok");
handle("app_status", fn as never);
const call = (senderFrame: { url: string } | null) =>
  handlers.get("app_status")!({ senderFrame }, undefined);

describe("handle", () => {
  it("runs the handler for the bundled renderer", async () => {
    await expect(call({ url: `${pathToFileURL(index).href}#/` })).resolves.toBe(
      "ok",
    );
  });

  it("rejects a call from any other page, or a frame that is gone", async () => {
    fn.mockClear();
    const other = pathToFileURL(path.join(os.tmpdir(), "evil.html")).href;
    await expect(call({ url: other })).rejects.toThrow(/rejected/);
    await expect(call({ url: "https://example.com/" })).rejects.toThrow(
      /rejected/,
    );
    await expect(call(null)).rejects.toThrow(/rejected/);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("handleExtraFor", () => {
  const handleExtra = handleExtraFor(["my_app_ping"]);
  const extraFn = vi.fn((raw: unknown) => ({ echoed: raw }));
  handleExtra("my_app_ping", extraFn);
  const callExtra = (senderFrame: { url: string } | null, raw: unknown) =>
    handlers.get("my_app_ping")!({ senderFrame }, raw);

  it("passes the raw payload through for the bundled renderer", async () => {
    const payload = { anything: [1, "two"] };
    await expect(
      callExtra({ url: `${pathToFileURL(index).href}#/` }, payload),
    ).resolves.toEqual({ echoed: payload });
    expect(extraFn).toHaveBeenCalledWith(payload, expect.anything());
  });

  it("rejects a call from any other page, or a frame that is gone", async () => {
    extraFn.mockClear();
    const other = pathToFileURL(path.join(os.tmpdir(), "evil.html")).href;
    await expect(callExtra({ url: other }, 1)).rejects.toThrow(/rejected/);
    await expect(callExtra({ url: "https://example.com/" }, 1)).rejects.toThrow(
      /rejected/,
    );
    await expect(callExtra(null, 1)).rejects.toThrow(/rejected/);
    expect(extraFn).not.toHaveBeenCalled();
  });

  it("throws for a channel not in extraChannels, registering nothing", () => {
    const meguriHandler = handlers.get("app_status");
    expect(() => handleExtra("not_listed", () => "x")).toThrow(
      /not in extraChannels/,
    );
    expect(() => handleExtra("app_status", () => "x")).toThrow(
      /not in extraChannels/,
    );
    expect(handlers.has("not_listed")).toBe(false);
    expect(handlers.get("app_status")).toBe(meguriHandler);
  });
});
