// Record the pet GIF (docs/assets/pet.gif): the pixel-art zabuton being picked
// up and dropped, fed a file (which queues it in Watch Later), and asked to
// bring something back.
import path from "node:path";
import {
  assetsDir,
  launchApp,
  resolveMediaRoot,
  seedTags,
  showToasts,
  sleep,
  startRecording,
  waitReady,
} from "./lib.mjs";

// A smaller window and the large sprite, so the pet reads at GIF size.
const { page, close } = await launchApp({
  mediaRoot: resolveMediaRoot(),
  width: 1000,
  height: 640,
});

const pet = page.getByRole("button", { name: "Zabuton pet" });

async function center(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

try {
  await waitReady(page);
  // Applied by the reload in seedTags(), which also gives the cards their
  // tag chips like the other captures.
  await page.evaluate(() => {
    localStorage.setItem("meguri.prefs", JSON.stringify({ petSize: "large" }));
  });
  await seedTags(page);
  await showToasts(page);
  await pet.waitFor();

  const rec = await startRecording(page, path.join(assetsDir, "pet.gif"));
  await sleep(2500); // let it wander

  // 1) pick it up, carry it across and let it fall back to the floor
  let at = await center(pet);
  await page.mouse.move(at.x, at.y, { steps: 10 });
  await sleep(400);
  await page.mouse.down();
  await page.mouse.move(at.x + 120, at.y - 260, { steps: 20 });
  await sleep(500);
  await page.mouse.move(at.x + 320, at.y - 300, { steps: 20 });
  await sleep(500);
  await page.mouse.up();
  await sleep(2200);

  // 2) feed it a file: it goes to Watch Later
  const card = page.getByTestId("media-card").nth(1);
  const from = await center(card);
  await page.mouse.move(from.x, from.y, { steps: 12 });
  await sleep(300);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 40, { steps: 6 });
  at = await center(pet);
  await page.mouse.move(at.x, at.y - 30, { steps: 30 });
  await sleep(700);
  at = await center(pet);
  await page.mouse.move(at.x, at.y, { steps: 6 });
  await sleep(500);
  await page.mouse.up();
  await sleep(3500);

  // 3) its menu, and a file it brings back
  await pet.click({ button: "right" });
  await sleep(1500);
  await page.getByRole("menuitem", { name: "Bring me something" }).click();
  await sleep(4500);

  await rec.stop();
} finally {
  await close();
}
