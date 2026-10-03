// Record the graph view GIF (docs/assets/graph.gif) and its stills
// (graph-2d.png / graph-3d.png): files and their tags as a network, picking a
// tag from the search, then the same graph in 3D.
import path from "node:path";
import {
  assetsDir,
  launchApp,
  resolveMediaRoot,
  screenshotTo,
  seedTags,
  sleep,
  startRecording,
  waitReady,
} from "./lib.mjs";

const { page, close } = await launchApp({ mediaRoot: resolveMediaRoot() });

const fit = () => page.getByRole("button", { name: "Fit to screen" }).click();

// Park the pointer on the toolbar's empty stretch. The layout starts from
// random positions, so anywhere on the canvas may be a node, and a hovered
// node takes the highlight from the picked one.
const parkPointer = () => page.mouse.move(560, 120);

// Drag across the canvas: pans in 2D, orbits in 3D.
async function drag(from, to, steps = 24) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

try {
  await waitReady(page);
  // Larger nodes and links, and labels that stay on when zoomed out, so the
  // graph still reads once the capture is scaled down. Only `display` is
  // given: the forces fall back to their defaults. Applied by the reload in
  // seedTags().
  await page.evaluate(() => {
    localStorage.setItem(
      "meguri.graph.settings",
      JSON.stringify({
        display: {
          sizeBy: "links",
          textFade: -2,
          nodeSize: 1.6,
          lineSize: 1.8,
        },
      }),
    );
  });
  await seedTags(page);

  const rec = await startRecording(page, path.join(assetsDir, "graph.gif"));
  await sleep(1000);

  // 1) open the graph and let the layout settle
  await page.getByRole("button", { name: "Graph view" }).click();
  await page.locator('[data-slot="graph-canvas"]').waitFor({ timeout: 30_000 });
  await sleep(1500);
  await fit();
  await sleep(1500);

  // 2) pick a tag from the search: its neighbourhood lights up
  const search = page.getByPlaceholder("Find by file or tag name");
  await search.click();
  await search.pressSequentially("sea", { delay: 140 });
  await sleep(900);
  await page.keyboard.press("Enter");
  await parkPointer();
  await sleep(2500);
  await screenshotTo(page, path.join(assetsDir, "graph-2d.png"));

  // 3) the same graph in 3D, orbited
  await page.getByRole("radio", { name: "3D" }).click();
  await page
    .locator('[data-slot="graph-canvas-3d"]')
    .waitFor({ timeout: 30_000 });
  await sleep(3000);
  await fit();
  await sleep(800);
  await page.mouse.move(690, 470);
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, -120);
    await sleep(150);
  }
  await sleep(600);
  // Orbit from a corner of the canvas: a press on a node would drag that node
  // instead.
  await drag({ x: 180, y: 220 }, { x: 520, y: 170 }, 40);
  await sleep(500);
  await drag({ x: 180, y: 220 }, { x: 240, y: 420 }, 40);
  await parkPointer();
  await sleep(1500);

  await rec.stop();
  await screenshotTo(page, path.join(assetsDir, "graph-3d.png"));
} finally {
  await close();
}
