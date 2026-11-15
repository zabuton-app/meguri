import { describe, expect, it } from "vitest";
import { languageName, trackLabel } from "@/lib/trackLabels";

describe("languageName", () => {
  it("names ISO 639-2 and BCP 47 tags in the UI language", () => {
    expect(languageName("jpn", "en")).toBe("Japanese");
    expect(languageName("ja", "en")).toBe("Japanese");
    expect(languageName("eng", "ja")).toBe("英語");
  });

  it("returns an empty or malformed tag unchanged", () => {
    expect(languageName("", "en")).toBe("");
    expect(languageName("xx1", "en")).toBe("xx1");
  });
});

describe("trackLabel", () => {
  it("prefers the title and adds the language below it", () => {
    expect(
      trackLabel({ title: "Commentary", language: "eng" }, "Track 2", "en"),
    ).toEqual({ label: "Commentary", detail: "English" });
  });

  it("does not repeat a language the title already says", () => {
    expect(
      trackLabel({ title: "English", language: "eng" }, "Track 1", "en"),
    ).toEqual({ label: "English", detail: "" });
  });

  it("falls back to the language, then to the track number", () => {
    expect(trackLabel({ title: "", language: "fra" }, "Track 3", "en")).toEqual(
      { label: "French", detail: "" },
    );
    expect(trackLabel({ title: "", language: "" }, "Track 4", "en")).toEqual({
      label: "Track 4",
      detail: "",
    });
  });
});
