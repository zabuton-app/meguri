// Only the bundled renderer (or the dev server) counts as the app (#272).
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAppUrl, setRendererIndex } from "../appUrl.js";

const dir = path.join(os.tmpdir(), "meguri-app", "renderer");
const index = path.join(dir, "index.html");
beforeEach(() => setRendererIndex(index));

const devUrl = process.env["ELECTRON_RENDERER_URL"];
afterEach(() => {
  if (devUrl === undefined) delete process.env["ELECTRON_RENDERER_URL"];
  else process.env["ELECTRON_RENDERER_URL"] = devUrl;
});

describe("isAppUrl", () => {
  it("accepts the bundled index.html and its hash routes", () => {
    const url = pathToFileURL(index).href;
    expect(isAppUrl(url)).toBe(true);
    expect(isAppUrl(`${url}#/file/5?ws=a`)).toBe(true);
  });

  it("matches an install path with '%' in it by the file it names", () => {
    const odd = path.join(os.tmpdir(), "Meguri%20Test", "index.html");
    setRendererIndex(odd);
    expect(isAppUrl(pathToFileURL(odd).href)).toBe(true);
    // The same characters unescaped name another folder: "Meguri Test".
    expect(isAppUrl(`file://${odd}`)).toBe(false);
  });

  it("rejects the index's path on another host", () => {
    expect(
      isAppUrl(pathToFileURL(index).href.replace("file://", "file://evil")),
    ).toBe(false);
  });

  it("rejects any other local file", () => {
    expect(isAppUrl(pathToFileURL(path.join(dir, "other.html")).href)).toBe(
      false,
    );
    expect(
      isAppUrl(pathToFileURL(path.join(os.tmpdir(), "index.html")).href),
    ).toBe(false);
  });

  it("rejects web pages and anything unparsable", () => {
    delete process.env["ELECTRON_RENDERER_URL"];
    expect(isAppUrl("https://example.com/")).toBe(false);
    expect(isAppUrl("http://localhost:5173/")).toBe(false);
    expect(isAppUrl("")).toBe(false);
    expect(isAppUrl("not a url")).toBe(false);
  });

  it("accepts the dev server's origin while it is set", () => {
    setRendererIndex(index, { allowDevServer: true });
    process.env["ELECTRON_RENDERER_URL"] = "http://localhost:5173";
    expect(isAppUrl("http://localhost:5173/#/settings")).toBe(true);
    expect(isAppUrl("http://localhost:5174/")).toBe(false);
  });

  it("ignores the dev server unless allowed, as in a packaged build", () => {
    process.env["ELECTRON_RENDERER_URL"] = "https://example.com";
    expect(isAppUrl("https://example.com/")).toBe(false);
  });
});
