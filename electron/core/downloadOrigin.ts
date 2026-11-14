import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { DownloadOriginEntry } from "../../shared/downloadOrigin.js";
import { Semaphore } from "./concurrency.js";
import { isInsideRoot } from "./paths.js";

const run = promisify(execFile);
const slots = new Semaphore(2);
const attribute = "com.apple.metadata:kMDItemWhereFroms";
const maxBuffer = 128 * 1024;

function parseEntries(value: unknown): DownloadOriginEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((url: unknown, index) => {
    if (typeof url !== "string" || url.length > 8192) return [];
    if (!/^https?:\/\//i.test(url)) return [];
    try {
      const parsed = new URL(url);
      if (!parsed.hostname || parsed.username || parsed.password) return [];
      const kind =
        index === 0 ? "download" : index === 1 ? "referrer" : "other";
      return [{ kind, url, hostname: parsed.hostname }];
    } catch {
      return [];
    }
  });
}

/** Read the OS's record only when asked. Command errors can include private URLs. */
export async function readDownloadOrigin(
  absPath: string,
  root: string,
): Promise<DownloadOriginEntry[]> {
  if (process.platform !== "darwin") return [];
  const signal = AbortSignal.timeout(2_000);
  const release = await slots
    .acquire({ signal, maxWaiting: 8 })
    .catch(() => null);
  if (!release) return [];
  try {
    const abs = await realpath(absPath);
    if (!isInsideRoot(abs, root) || !(await stat(abs)).isFile()) return [];

    const options = { signal, maxBuffer };
    const { stdout } = await run(
      "/usr/bin/xattr",
      ["-psx", attribute, abs],
      options,
    );
    const hex = stdout.replace(/\s+/g, "");
    if (!/^(?:[\da-f]{2})+$/i.test(hex)) return [];

    const conversion = run(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", "-"],
      options,
    );
    conversion.child.stdin?.on("error", () => {});
    conversion.child.stdin?.end(Buffer.from(hex, "hex"));
    return parseEntries(JSON.parse((await conversion).stdout));
  } catch {
    // Missing, malformed, and unreadable attributes are all hidden in details.
    return [];
  } finally {
    release();
  }
}
