// The detail view's metadata badges: for audio, what its stored probe output
// says (#468).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetaChips } from "@/routes/MediaDetail/MetaChips";
import type { FileDetail } from "@/ipc/types";

const t = (key: string) => key;

function detail(kind: string, meta: unknown): FileDetail {
  return {
    kind,
    width: null,
    height: null,
    size: 1000,
    codec: "flac",
    fps: null,
    meta,
  } as unknown as FileDetail;
}

const chip = (label: string) =>
  screen.queryByText(label)?.nextElementSibling?.textContent ?? null;

function renderChips(d: FileDetail) {
  render(
    <MetaChips
      detail={d}
      wsId="ws"
      workspaceLabel="Music"
      workspacePath="/music"
      total={120}
      t={t as never}
    />,
  );
}

describe("MetaChips for audio", () => {
  it("shows the format, channels, BPM, key and genres the file holds", () => {
    renderChips(
      detail("audio", {
        streams: [
          {
            codec_type: "audio",
            codec_name: "flac",
            sample_rate: "96000",
            bits_per_raw_sample: "24",
            channels: 2,
          },
        ],
        format: {
          tags: { BPM: "96.5", INITIALKEY: "8A", GENRE: "Jazz; Soul" },
        },
      }),
    );
    expect(chip("media.metaSampleRate")).toBe("96 kHz");
    expect(chip("media.metaBitDepth")).toBe("24-bit");
    expect(chip("media.metaChannels")).toBe("tags.value.chStereo");
    expect(chip("media.metaBpm")).toBe("96.5 (tags.value.tempoModerate)");
    expect(chip("media.metaKey")).toBe("A minor (8A)");
    expect(chip("media.metaGenre")).toBe("jazz, soul");
  });

  it("leaves out what the file does not say", () => {
    renderChips(
      detail("audio", {
        streams: [
          {
            codec_type: "audio",
            codec_name: "mp3",
            sample_rate: "44100",
            bits_per_sample: 0,
            channels: 6,
          },
        ],
      }),
    );
    expect(chip("media.metaSampleRate")).toBe("44.1 kHz");
    expect(chip("media.metaChannels")).toBe("tags.value.chSurround (6)");
    for (const label of [
      "media.metaBitDepth",
      "media.metaBpm",
      "media.metaKey",
      "media.metaGenre",
    ])
      expect(chip(label)).toBeNull();
  });

  it("shows none of it for a video, or without probe output", () => {
    renderChips(detail("audio", null));
    expect(chip("media.metaSampleRate")).toBeNull();
    renderChips(
      detail("video", {
        streams: [{ codec_type: "audio", sample_rate: "48000" }],
      }),
    );
    expect(chip("media.metaSampleRate")).toBeNull();
  });
  it("states a sample rate to the hertz", () => {
    renderChips(
      detail("audio", {
        streams: [{ codec_type: "audio", sample_rate: "22050" }],
      }),
    );
    expect(chip("media.metaSampleRate")).toBe("22.05 kHz");
  });
});
