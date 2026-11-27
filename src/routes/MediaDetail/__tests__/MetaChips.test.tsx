// The detail view's metadata badges: for audio, what its stored probe output
// says (#468).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetaChips } from "@/routes/MediaDetail/MetaChips";
import type { FileDetail } from "@/ipc/types";

const t = (key: string) => key;

function detail(kind: string, meta: unknown, exif: unknown = null): FileDetail {
  return {
    kind,
    width: null,
    height: null,
    size: 1000,
    codec: "flac",
    fps: null,
    meta,
    exif,
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
      lang="en"
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

describe("MetaChips for photos (#701)", () => {
  const exif = {
    make: "Canon",
    model: "Canon EOS R5",
    lens: "RF24-105mm F4 L IS USM",
    fNumber: 4,
    exposureTime: 0.008,
    iso: 200,
    focalLength: 50,
    focalLength35mm: 50,
  };

  it("shows the camera, lens, exposure and focal length", () => {
    renderChips(detail("image", null, exif));
    expect(chip("media.metaCamera")).toBe("Canon EOS R5");
    expect(chip("media.metaLens")).toBe("RF24-105mm F4 L IS USM");
    expect(chip("media.metaExposure")).toBe("f/4 · 1/125s · ISO 200");
    expect(chip("media.metaFocalLength")).toBe("50 mm");
  });

  it("gives the 35 mm equivalent when it differs", () => {
    renderChips(
      detail("image", null, { focalLength: 6.765, focalLength35mm: 24 }),
    );
    expect(chip("media.metaFocalLength")).toBe("6.8 mm (media.metaFocalEquiv)");
  });

  it("leaves out what the photo does not say", () => {
    renderChips(detail("image", null, { iso: 100 }));
    expect(chip("media.metaCamera")).toBeNull();
    expect(chip("media.metaLens")).toBeNull();
    expect(chip("media.metaExposure")).toBe("ISO 100");
    expect(chip("media.metaFocalLength")).toBeNull();
  });

  it("shows nothing for a photo without EXIF, or for a video", () => {
    renderChips(detail("image", null, {}));
    expect(chip("media.metaExposure")).toBeNull();
    renderChips(detail("video", null, exif));
    expect(chip("media.metaCamera")).toBeNull();
  });
});

describe("MetaChips capture date (#725)", () => {
  it("shows when the file was captured, in the app's language", () => {
    renderChips({
      ...detail("video", null),
      capturedAt: 1_563_687_300,
    });
    expect(chip("media.metaCaptured")).toBe(
      new Date(1_563_687_300 * 1000).toLocaleString("en"),
    );
  });

  it("shows no capture date when the file has none", () => {
    renderChips({ ...detail("image", null), capturedAt: null });
    expect(chip("media.metaCaptured")).toBeNull();
  });
});
