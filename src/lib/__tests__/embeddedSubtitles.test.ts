import { describe, expect, it } from "vitest";
import {
  readEmbeddedTracks,
  readWebVtt,
  sameSubtitleLanguage,
} from "@shared/embeddedSubtitles";
import {
  AUTO_SUBTITLE,
  readSubtitlePreference,
  saveSubtitlePreference,
  SUBTITLES_OFF,
  subtitlePreferenceKey,
} from "../subtitlePreference";

describe("embedded subtitle metadata", () => {
  it("reads short timestamps and cue settings and preserves escaped text", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:02.500 --> 00:03.750 align:start",
      "<i>Hello</i>&nbsp;&lt;world&gt; &amp;lt;",
      "",
      "00:00:08.000 --> 00:00:07.000",
      "Invalid duration",
    ].join("\r\n");
    expect(readWebVtt(vtt)).toEqual([
      { start: 2.5, end: 3.75, text: "Hello <world> &lt;" },
    ]);
  });

  it("preserves embedded track order, including bitmap tracks", () => {
    const metadata = {
      streams: [
        { codec_type: "audio", codec_name: "aac" },
        { codec_type: "subtitle", codec_name: "hdmv_pgs_subtitle" },
        {
          codec_type: "subtitle",
          codec_name: "subrip",
          tags: { handler_name: " English ", language: "eng" },
        },
      ],
    };
    expect(readEmbeddedTracks(JSON.stringify(metadata), "subtitle")).toEqual([
      { title: "", language: "", codec: "hdmv_pgs_subtitle" },
      { title: "English", language: "eng", codec: "subrip" },
    ]);
    expect(readEmbeddedTracks("invalid JSON", "subtitle")).toEqual([]);
  });

  it("matches regional tags by language and excludes unknown languages", () => {
    expect(sameSubtitleLanguage("en-GB", "en-US")).toBe(true);
    expect(sameSubtitleLanguage("eng", "fra")).toBe(false);
    expect(sameSubtitleLanguage("", "")).toBe(false);
  });
});

describe("subtitle preferences", () => {
  it("remembers a specific track or Off independently for each clip", () => {
    const first = subtitlePreferenceKey("library", "first.mkv");
    const second = subtitlePreferenceKey("library", "second.mkv");
    saveSubtitlePreference(first, 0);
    saveSubtitlePreference(second, SUBTITLES_OFF);
    expect(readSubtitlePreference(first)).toBe(0);
    expect(readSubtitlePreference(second)).toBe(SUBTITLES_OFF);
    expect(
      readSubtitlePreference(subtitlePreferenceKey("other", "first.mkv")),
    ).toBe(AUTO_SUBTITLE);
  });
});
