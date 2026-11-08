import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ignoredScanPath, kindForExt } from "./core/scan.js";
import { pool } from "./core/concurrency.js";
import log from "./core/logger.js";

const QUIET_MS = 2000;
const STABLE_MS = 750;
export const MAX_PENDING_PATHS = 1000;

interface WatchedRoot {
  path: string;
  watcher: fs.FSWatcher | null;
  pending: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  flushing: boolean;
}

/** Native notifications only: no polling or filesystem work while idle. */
export class FolderWatcher {
  private roots = new Map<string, WatchedRoot>();
  private enabled = false;
  private lastStatus = "";
  constructor(
    private readonly onChange: (
      id: string,
      paths: string[] | undefined,
    ) => void,
    private readonly onStatus?: (
      status: ReturnType<FolderWatcher["status"]>,
    ) => void,
    private readonly ignoredRoots: readonly string[] = [],
  ) {}

  private notify(): void {
    const status = this.status();
    const encoded = JSON.stringify(status);
    if (encoded === this.lastStatus) return;
    this.lastStatus = encoded;
    this.onStatus?.(status);
  }

  status(): { enabled: boolean; watched: number; unavailable: string[] } {
    return {
      enabled: this.enabled,
      watched: [...this.roots.values()].filter((r) => r.watcher != null).length,
      unavailable: [...this.roots]
        .filter(([, r]) => !r.watcher)
        .map(([id]) => id),
    };
  }

  sync(roots: { id: string; path: string }[], enabled: boolean): void {
    this.enabled = enabled;
    const wanted = new Map(
      (enabled ? roots : []).filter((r) => r.path).map((r) => [r.id, r.path]),
    );
    for (const [id, root] of this.roots)
      if (wanted.get(id) !== root.path || !root.watcher) this.remove(id);
    for (const [id, directory] of wanted) {
      if (this.roots.has(id)) continue;
      const root: WatchedRoot = {
        path: directory,
        watcher: null,
        pending: new Map(),
        timer: null,
        closed: false,
        flushing: false,
      };
      this.roots.set(id, root);
      try {
        root.watcher = fs.watch(
          directory,
          { recursive: true, persistent: false },
          (event, filename) => {
            if (root.closed) return;
            const relative =
              filename == null ? "" : path.normalize(String(filename));
            const absolute = path.resolve(directory, relative);
            if (
              this.ignoredRoots.some(
                (p) => absolute === p || absolute.startsWith(p + path.sep),
              )
            )
              return;
            if (
              relative &&
              (path.isAbsolute(relative) ||
                relative === ".." ||
                relative.startsWith(`..${path.sep}`) ||
                ignoredScanPath(relative))
            )
              return;
            // Writes to unrelated files do not even schedule a stat. Renames may
            // describe a new/deleted directory, so those are resolved in the batch.
            if (
              event === "change" &&
              relative &&
              !kindForExt(path.extname(relative).slice(1))
            )
              return;
            const now = Date.now();
            if (
              root.pending.has("") ||
              root.pending.size >= MAX_PENDING_PATHS
            ) {
              root.pending.clear();
              root.pending.set("", now);
            } else root.pending.set(relative === "." ? "" : relative, now);
            this.schedule(id, root);
          },
        );
        root.watcher.on("error", (error) => {
          log.warn("folder watching unavailable", error);
          this.unavailable(root);
          this.notify();
        });
      } catch (error) {
        log.warn("folder watching unavailable", error);
      }
    }
    this.notify();
  }

  remove(id: string): void {
    const root = this.roots.get(id);
    if (!root) return;
    root.closed = true;
    this.unavailable(root);
    this.roots.delete(id);
    this.notify();
  }

  close(): void {
    this.enabled = false;
    for (const id of this.roots.keys()) this.remove(id);
  }

  private unavailable(root: WatchedRoot): void {
    root.watcher?.close();
    root.watcher = null;
    if (root.timer) clearTimeout(root.timer);
    root.timer = null;
    root.pending.clear();
  }

  private schedule(id: string, root: WatchedRoot): void {
    if (root.closed || root.flushing || !root.pending.size) return;
    if (root.timer) clearTimeout(root.timer);
    const due = Math.min(...root.pending.values()) + QUIET_MS;
    root.timer = setTimeout(
      () => {
        root.timer = null;
        void this.flush(id, root);
      },
      Math.max(0, due - Date.now()),
    );
    root.timer.unref();
  }

  private async flush(id: string, root: WatchedRoot): Promise<void> {
    if (root.closed || root.flushing) return;
    root.flushing = true;
    try {
      if (!(await fsp.stat(root.path).catch(() => null))?.isDirectory()) {
        this.unavailable(root);
        this.notify();
        return;
      }
      const batch = [...root.pending].filter(
        ([, time]) => time + QUIET_MS <= Date.now(),
      );
      const snapshots = new Map<string, string>();
      const snapshot = async (relative: string) => {
        try {
          const stat = await fsp.lstat(path.join(root.path, relative));
          return `${stat.size}:${stat.mtimeMs}`;
        } catch (error) {
          return ["ENOENT", "ENOTDIR"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
            ? "missing"
            : null;
        }
      };
      await pool(batch, 8, async ([relative]) => {
        const stamp = await snapshot(relative);
        if (stamp != null) snapshots.set(relative, stamp);
      });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STABLE_MS);
        timer.unref();
      });
      const settled: string[] = [];
      await pool(batch, 8, async ([relative, time]) => {
        if (root.closed || root.pending.get(relative) !== time) return;
        const stamp = await snapshot(relative);
        if (stamp != null && stamp === snapshots.get(relative)) {
          settled.push(relative);
          root.pending.delete(relative);
        } else if (stamp == null) root.pending.delete(relative);
        else root.pending.set(relative, Date.now());
      });
      // A directory notification must not pull in a child still being written.
      const ready = settled.filter((relative) => {
        if (
          [...root.pending.keys()].some(
            (child) =>
              relative === "" || child.startsWith(`${relative}${path.sep}`),
          )
        ) {
          root.pending.set(relative, Date.now());
          return false;
        }
        return true;
      });
      if (!root.closed && root.watcher && ready.length)
        this.onChange(id, ready.includes("") ? undefined : ready);
    } catch (error) {
      log.warn("folder change processing failed", error);
    } finally {
      root.flushing = false;
      this.schedule(id, root);
    }
  }
}
