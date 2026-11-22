import { test, expect } from "./fixtures/app";
import { fileCard, waitForIndexedMedia } from "./fixtures/helpers";

test("diag drag onto Watch Later", async ({ ready }) => {
  await waitForIndexedMedia(ready);
  await ready.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { __log: string[] }).__log = log;
    const t0 = performance.now();
    const desc = (n: EventTarget | null) => {
      if (!(n instanceof Element)) return String(n);
      const card = n.closest("[data-testid=media-card]");
      return `${n.tagName.toLowerCase()}${n.getAttribute("data-slot") ? "[" + n.getAttribute("data-slot") + "]" : ""}${n.getAttribute("aria-label") ? "(" + n.getAttribute("aria-label") + ")" : ""}${card ? " in-card" : ""}${n.isConnected ? "" : " DETACHED"}`;
    };
    for (const type of [
      "mousemove",
      "mousedown",
      "mouseup",
      "pointerdown",
      "click",
      "dragstart",
      "dragenter",
      "dragover",
      "drop",
      "dragend",
      "mouseenter",
      "mouseout",
      "mouseover",
      "blur",
      "focus",
    ]) {
      window.addEventListener(
        type,
        (e) => {
          const me = e as MouseEvent;
          log.push(
            `${(performance.now() - t0).toFixed(1)} ${type} ${me.clientX},${me.clientY} buttons=${me.buttons} target=${desc(e.target)} prevented=${e.defaultPrevented}`,
          );
          if (type === "dragstart" || type === "mousedown" || type === "mousemove") {
            setTimeout(() =>
              log.push(
                `   (after ${type}) prevented=${e.defaultPrevented}`,
              ),
            );
          }
        },
        true,
      );
    }
    new MutationObserver((records) => {
      for (const r of records) {
        if (!(r.target instanceof Element)) continue;
        if (!r.target.closest("[data-testid=media-card]")) continue;
        log.push(
          `${(performance.now() - t0).toFixed(1)} mutation ${r.type} on ${desc(r.target)} +${r.addedNodes.length} -${r.removedNodes.length} ${r.attributeName ?? ""}`,
        );
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
  await fileCard(ready).dragTo(
    ready.getByRole("button", { name: "Watch Later", exact: true }),
  );
  const ok = await ready
    .getByText('Added 1 file to "Watch Later"')
    .waitFor({ timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  {
    const log = await ready.evaluate(
      () => (window as unknown as { __log: string[] }).__log,
    );
    console.log((ok ? "PASSED" : "FAILED") + " DROP LOG\n" + log.join("\n"));
  }
  expect(ok).toBe(true);
});
