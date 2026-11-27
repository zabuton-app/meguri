// Make a minidump fixture for electron/core/__tests__/minidump.test.ts (#545):
// launch the built app with a throwaway profile, crash its main process on
// purpose (process.crash()), and keep the dump Crashpad writes.
//
//   npm run build
//   node scripts/dev/crash-fixture.mjs
//   (Linux under xvfb: MEGURI_FORCE_X11=1 xvfb-run -a node scripts/dev/crash-fixture.mjs)
//
// Writes electron/core/__tests__/fixtures/minidump/<platform>-<arch>.dmp.
// Every byte the reader (electron/core/minidump.ts) does not read is zeroed and
// the file ends after the last one it reads, so the fixture holds no memory of
// the process and stays small; the user name in module paths is masked.
import { _electron } from "@playwright/test";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { readMinidump } from "../../electron/core/minidump.ts";

const require = createRequire(import.meta.url);
const { electronLaunchOptions } = require("../electron-launch.cjs");
const repoRoot = path.resolve(import.meta.dirname, "../..");

function findDumps(dir) {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((n) => n.endsWith(".dmp"))
    .map((n) => path.join(dir, n));
}

async function crashMainProcess(userDataDir) {
  const app = await _electron.launch(
    electronLaunchOptions({
      args: [`--user-data-dir=${userDataDir}`],
      env: { MEGURI_DISABLE_TRAY: "1", MEGURI_CRASH_REPORTS: "1" },
    }),
  );
  await app.firstWindow();
  // The connection drops with the process.
  await app.evaluate(() => process.crash()).catch(() => {});
  // Crashpad writes the dump from its own process: wait for it.
  const dumpsDir = path.join(userDataDir, "Crashpad");
  for (let i = 0; i < 100; i++) {
    const dumps = fs.existsSync(dumpsDir) ? findDumps(dumpsDir) : [];
    if (dumps.length > 0) {
      await new Promise((r) => setTimeout(r, 1000)); // let it finish writing
      await app.close().catch(() => {});
      return dumps[0];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await app.close().catch(() => {});
  throw new Error("no dump was written");
}

/** A copy with only the bytes the reader reads, up to the last of them. */
function strip(dump) {
  const out = Buffer.alloc(dump.length);
  let end = 0;
  readMinidump((offset, length) => {
    const bytes = dump.subarray(offset, offset + length);
    if (bytes.length !== length) throw new Error("truncated");
    bytes.copy(out, offset);
    end = Math.max(end, offset + length);
    return bytes;
  });
  // The user name in the home directory becomes x's, byte for byte, so
  // offsets and string lengths stay valid.
  const home = os.homedir();
  const cut = Math.max(home.lastIndexOf("/"), home.lastIndexOf("\\")) + 1;
  for (const encoding of ["utf16le", "utf8"]) {
    const from = Buffer.from(home, encoding);
    const to = Buffer.alloc(from.length, Buffer.from("x", encoding));
    Buffer.from(home.slice(0, cut), encoding).copy(to);
    for (
      let at = out.indexOf(from);
      at !== -1;
      at = out.indexOf(from, at + from.length)
    ) {
      to.copy(out, at);
    }
  }
  return out.subarray(0, end);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-crash-"));
try {
  const dump = await crashMainProcess(userDataDir);
  const target = path.join(
    repoRoot,
    "electron/core/__tests__/fixtures/minidump",
    `${process.platform}-${process.arch}.dmp`,
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, strip(fs.readFileSync(dump)));
  console.log(path.relative(repoRoot, target));
} finally {
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
