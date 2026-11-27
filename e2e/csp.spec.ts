// The packaged renderer reaches no local service but the app's media server,
// so neither an XSS nor a url() in custom CSS can probe others (#274).
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "./fixtures/app";

test.describe("Content Security Policy", () => {
  test("blocks other local services and the dev server's sources", async ({
    ready,
  }) => {
    // Another service on this machine, which would answer if asked.
    const server = http.createServer((_req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as AddressInfo).port;
    try {
      const blocked = await ready.evaluate(async (port) => {
        const other = `http://127.0.0.1:${port}/`;
        const violations: string[] = [];
        document.addEventListener("securitypolicyviolation", (e) =>
          violations.push(`${e.effectiveDirective} ${e.blockedURI}`),
        );
        // The app's own media server is not blocked.
        const { mediaOrigin } = (
          window as unknown as { api: { mediaOrigin: string } }
        ).api;
        if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(mediaOrigin)) {
          violations.push(`no media origin: "${mediaOrigin}"`);
        }
        await fetch(`${mediaOrigin}/`).catch(() => {});
        await fetch(other).catch(() => {});
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = img.onerror = resolve;
          img.src = `${other}pixel.png`;
        });
        try {
          new WebSocket(`ws://localhost:${port}/`).close();
        } catch {
          // A blocked socket throws on construction.
        }
        // A blocked socket may be reported a moment later.
        for (let i = 0; i < 50; i++) {
          if (violations.some((v) => v.includes("ws://"))) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        // Each policy that blocks a request reports it.
        return [...new Set(violations)].sort();
      }, port);
      expect(blocked).toEqual(
        [
          `connect-src http://127.0.0.1:${port}/`,
          `connect-src ws://localhost:${port}/`,
          `img-src http://127.0.0.1:${port}/pixel.png`,
        ].sort(),
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
