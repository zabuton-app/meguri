// extractMeta when the ffprobe binary cannot be started at all (missing or
// wrong-arch download): the file still gets empty meta, but the failure is
// logged once instead of being swallowed for every file.
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../logger.js", () => ({ default: { warn, error: vi.fn() } }));
vi.mock("../ffmpeg-paths.js", () => ({
  FFMPEG: "ffmpeg",
  FFPROBE: "/nonexistent/meguri-test/ffprobe",
}));

import { extractMeta } from "../media.js";

describe("extractMeta with an unavailable ffprobe", () => {
  it("returns empty meta and warns only once", async () => {
    const first = await extractMeta("/tmp/a.mp4", "video");
    await extractMeta("/tmp/b.mp4", "video");

    expect(first).toMatchObject({ width: null, codec: null, raw: null });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("ENOENT");
  });

  it("still reads a photo's EXIF (#701)", async () => {
    const photo = fileURLToPath(
      new URL("./fixtures/exif/dated-offset.jpg", import.meta.url),
    );
    const meta = await extractMeta(photo, "image");
    expect(meta.raw).toBeNull();
    expect(meta.capturedAt).toBe(Date.UTC(2019, 6, 21, 5, 35, 0) / 1000);
    expect(meta.exif?.model).toBe("Canon EOS R5");
  });
});
