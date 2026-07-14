import fs from "node:fs";
import path from "node:path";

const source = process.env.MEGURI_SAMPLE_CONFIG ?? "/app/samples/config.json";
const target =
  process.env.MEGURI_CONFIG_PATH ?? "/home/node/.config/meguri/config.json";
const force = process.env.MEGURI_SEED_SAMPLE_CONFIG === "force";

if (!fs.existsSync(source)) {
  process.exit(0);
}

if (!force && fs.existsSync(target)) {
  process.exit(0);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
