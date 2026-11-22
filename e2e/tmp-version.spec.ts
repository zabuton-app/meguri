import { _electron, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { electronLaunchOptions } from "../scripts/electron-launch.cjs";
test("version", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-v-"));
  const app = await _electron.launch(electronLaunchOptions({ args: [`--user-data-dir=${temp}`], env: { MEGURI_DISABLE_TRAY: "1" } }));
  console.log("VERSION", await app.evaluate(({ app }) => app.getVersion() + " " + app.getAppPath()));
  await app.close();
});
