// The playback probe's time limit covers the probe itself, not the wait for a
// free slot (#382). ffprobe is stubbed so the test decides when probes finish.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Probes of files named "slow*" hang until the test resolves them or their
// signal aborts, which, like the real extractMeta, yields no metadata.
const media = vi.hoisted(() => ({
  held: new Map<string, (raw: unknown) => void>(),
}));
vi.mock("../media.js", () => ({
  extractMeta: (file: string, _kind: string, signal?: AbortSignal) =>
    new Promise((resolve) => {
      const done = (raw: unknown) => resolve({ raw });
      signal?.addEventListener("abort", () => done(null));
      if (path.basename(file).startsWith("slow")) media.held.set(file, done);
      else done({ streams: [{ codec_type: "audio", codec_name: "ac3" }] });
    }),
}));

import { probePlaybackMetadata } from "../playbackMetadata.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-probe-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  media.held.clear();
  fs.rmSync(dir, { recursive: true, force: true });
});

function touch(name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "");
  return file;
}

describe("probePlaybackMetadata", () => {
  it("does not count the wait for a slot toward the probe timeout", async () => {
    // Every timeout the probe starts can be fired by the test.
    const timeouts: AbortController[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const c = new AbortController();
      timeouts.push(c);
      return c.signal;
    });

    const slowA = touch("slow-a.mkv");
    const slowB = touch("slow-b.mkv");
    const first = probePlaybackMetadata(slowA);
    const second = probePlaybackMetadata(slowB);
    await vi.waitFor(() => expect(media.held.size).toBe(2));

    // Both slots are busy, so this one waits. It asks for a slot right after
    // its stat settles, so once that and one more turn pass, it is queued.
    const stat = vi.spyOn(fs.promises, "stat");
    const waiting = probePlaybackMetadata(touch("dolby.mkv"));
    await stat.mock.results[0].value;
    await new Promise((r) => setImmediate(r));

    // Five seconds pass while it is still waiting.
    for (const c of timeouts) c.abort(new DOMException("", "TimeoutError"));
    media.held.get(slowA)!({ streams: [] });
    media.held.get(slowB)!({ streams: [] });
    await Promise.all([first, second]);

    await expect(waiting).resolves.toEqual({
      streams: [{ codec_type: "audio", codec_name: "ac3" }],
    });
  });

  it("still gives up on a probe that runs past the timeout", async () => {
    const timeouts: AbortController[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const c = new AbortController();
      timeouts.push(c);
      return c.signal;
    });

    const probe = probePlaybackMetadata(touch("slow-stuck.mkv"));
    await vi.waitFor(() => expect(media.held.size).toBe(1));
    for (const c of timeouts) c.abort(new DOMException("", "TimeoutError"));

    await expect(probe).resolves.toBeNull();
  });
});
