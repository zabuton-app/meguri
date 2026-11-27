// The H.264 encoder a video preview uses, picked from what the FFmpeg in use
// was built with.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { FFMPEG, FFPROBE } from "../ffmpeg-paths.js";
import {
  pickPreviewEncoder,
  previewEncoder,
  previewEncoderArgs,
} from "../videoPreview.js";

// Lines as `ffmpeg -hide_banner -encoders` prints them.
const HEADER = [
  "Encoders:",
  " V..... = Video",
  " ------",
  " V....D a64multi             Multicolor charset for Commodore 64 (codec a64_multi)",
];
const LIBX264 =
  " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)";
const LIBX264RGB =
  " V....D libx264rgb           libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 RGB (codec h264)";
const VIDEOTOOLBOX =
  " V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)";

const list = (...lines: string[]) => [...HEADER, ...lines].join("\n") + "\n";

describe("pickPreviewEncoder", () => {
  it("keeps libx264 when the build has it", () => {
    expect(pickPreviewEncoder(list(LIBX264, VIDEOTOOLBOX))).toBe("libx264");
  });

  it("falls back to VideoToolbox in a build without libx264", () => {
    expect(pickPreviewEncoder(list(VIDEOTOOLBOX))).toBe("h264_videotoolbox");
  });

  it("does not take libx264rgb for libx264", () => {
    expect(pickPreviewEncoder(list(LIBX264RGB, VIDEOTOOLBOX))).toBe(
      "h264_videotoolbox",
    );
  });

  it("finds neither in a build without them", () => {
    expect(pickPreviewEncoder(list())).toBeNull();
  });
});

describe("the bundled FFmpeg", () => {
  const encoders = () =>
    execFileSync(FFMPEG, ["-hide_banner", "-encoders"], { encoding: "utf8" });

  it("lists libx264 in a form pickPreviewEncoder reads", async () => {
    // The bundled builds are GPL builds with libx264 on every platform.
    expect(pickPreviewEncoder(encoders())).toBe("libx264");
    expect(await previewEncoder()).toBe("libx264");
  });

  // An LGPL build lists the same encoders minus libx264.
  it.skipIf(process.platform !== "darwin")(
    "lists VideoToolbox for a build without libx264",
    () => {
      const withoutX264 = encoders()
        .split("\n")
        .filter((line) => !/ libx264 /.test(line))
        .join("\n");
      expect(pickPreviewEncoder(withoutX264)).toBe("h264_videotoolbox");
    },
  );
});

describe("previewEncoderArgs", () => {
  // The bundled macOS build has VideoToolbox too, so its arguments can be
  // tried for real there, the way a preview uses them.
  it.skipIf(process.platform !== "darwin")(
    "encodes a preview with VideoToolbox",
    () => {
      const mp4 = execFileSync(
        FFMPEG,
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=640x360:rate=24:duration=2",
          ...previewEncoderArgs("h264_videotoolbox"),
          "-pix_fmt",
          "yuv420p",
          "-force_key_frames",
          "expr:gte(t,n_forced*1)",
          "-movflags",
          "frag_keyframe+empty_moov+default_base_moof",
          "-f",
          "mp4",
          "pipe:1",
        ],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      const probe = JSON.parse(
        execFileSync(
          FFPROBE,
          [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height:packet=flags,pts_time",
            "-of",
            "json",
            "pipe:0",
          ],
          { input: mp4, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        ),
      ) as {
        streams: { codec_name: string; width: number; height: number }[];
        packets: { flags: string; pts_time: string }[];
      };
      expect(probe.streams[0]).toMatchObject({
        codec_name: "h264",
        width: 640,
        height: 360,
      });
      // A forced keyframe each second, which seeking in the preview relies on.
      // Compared by spacing, since frame reordering can shift every timestamp.
      const keyframes = probe.packets
        .filter((p) => p.flags.startsWith("K"))
        .map((p) => Number(p.pts_time))
        .sort((a, b) => a - b);
      expect(keyframes.some((t) => Math.abs(t - keyframes[0] - 1) < 0.05)).toBe(
        true,
      );
    },
  );
});
