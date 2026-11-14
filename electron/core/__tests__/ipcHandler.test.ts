// handle() answers the app's own page only (#272).
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

const { handle } = await import("../ipcHandler.js");
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
