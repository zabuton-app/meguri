// The control bar's audio and subtitles panel: what each column offers, what
// Match audio language says it resolves to, and where the panel renders.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { I18nProvider, type TFunc } from "@/i18n/I18nProvider";
import { TrackPanel } from "@/routes/MediaDetail/TrackPanel";
import { AUTO_SUBTITLE } from "@/lib/subtitlePreference";
import { DEFAULT_AUDIO_TRACK } from "@shared/playbackTracks";

const t = ((key: string, params?: Record<string, string | number>) =>
  params?.track ? `${key}:${params.track}` : key) as TFunc;

afterEach(cleanup);

const subtitleTracks = [
  { title: "English", language: "eng", codec: "subrip" },
  { title: "Signs", language: "eng", codec: "hdmv_pgs_subtitle" },
  { title: "日本語", language: "jpn", codec: "ass" },
];

function subtitles(
  overrides: Partial<
    NonNullable<Parameters<typeof TrackPanel>[0]["subtitles"]>
  > = {},
) {
  return {
    tracks: subtitleTracks,
    value: AUTO_SUBTITLE,
    onChange: vi.fn(),
    audioLanguage: "eng",
    autoTrack: 0,
    shown: true,
    status: "idle" as const,
    moved: false,
    onResetPosition: vi.fn(),
    ...overrides,
  };
}

function open(props: Partial<Parameters<typeof TrackPanel>[0]> = {}) {
  const target = document.createElement("div");
  document.body.append(target);
  render(
    <I18nProvider>
      <TrackPanel portalTarget={() => target} t={t} {...props} />
    </I18nProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "player.audioSubtitles" }),
  );
  return { target, panel: screen.getByRole("dialog") };
}

const column = (name: string) => screen.getByRole("group", { name });

describe("TrackPanel", () => {
  it("renders inside the element that goes fullscreen", () => {
    const { target, panel } = open({ subtitles: subtitles() });
    expect(target.contains(panel)).toBe(true);
  });

  it("lists text subtitle tracks only, and says what Match audio language picks", () => {
    open({ subtitles: subtitles() });
    const radios = within(column("player.subtitles")).getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(screen.queryByText("Signs")).toBeNull();
    expect(screen.getByText("player.subtitleAutoMatch:English")).toBeTruthy();
  });

  it("says Match audio language turns subtitles off when it finds nothing", () => {
    open({ subtitles: subtitles({ autoTrack: -1 }) });
    expect(screen.getByText("player.subtitleAutoNone")).toBeTruthy();
    cleanup();
    open({ subtitles: subtitles({ audioLanguage: "" }) });
    expect(screen.getByText("player.subtitleAutoUnknown")).toBeTruthy();
  });

  it("shows a saved bitmap track as Off and reports a choice", () => {
    const onChange = vi.fn();
    open({ subtitles: subtitles({ value: 1, onChange }) });
    const radios = within(
      column("player.subtitles"),
    ).getAllByRole<HTMLInputElement>("radio");
    expect(radios[0].checked).toBe(true);
    fireEvent.click(radios[3]);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("explains a subtitle failure in the panel", () => {
    open({ subtitles: subtitles({ status: "error" }) });
    expect(
      within(column("player.subtitles")).getByText(
        "player.subtitleUnavailable",
      ),
    ).toBeTruthy();
  });

  it("offers to reset the captions' position only once they were moved", () => {
    open({ subtitles: subtitles() });
    const reset = () =>
      within(column("player.subtitles")).getByRole<HTMLButtonElement>(
        "button",
        { name: "player.subtitleResetPosition" },
      );
    expect(reset().disabled).toBe(true);
    cleanup();

    const onResetPosition = vi.fn();
    open({ subtitles: subtitles({ moved: true, onResetPosition }) });
    expect(reset().disabled).toBe(false);
    fireEvent.click(reset());
    expect(onResetPosition).toHaveBeenCalledTimes(1);
  });

  it("puts audio beside subtitles, or alone when the clip has no text subtitles", () => {
    const onChange = vi.fn();
    const audio = {
      tracks: [
        { title: "Main", language: "eng" },
        { title: "Commentary", language: "eng" },
      ],
      value: DEFAULT_AUDIO_TRACK,
      disabled: false,
      onChange,
    };
    open({ audio, subtitles: subtitles() });
    expect(column("player.audioTrack")).toBeTruthy();
    expect(column("player.subtitles")).toBeTruthy();
    cleanup();

    open({ audio });
    expect(
      screen.queryByRole("group", { name: "player.subtitles" }),
    ).toBeNull();
    const radios = within(
      column("player.audioTrack"),
    ).getAllByRole<HTMLInputElement>("radio");
    expect(radios[0].checked).toBe(true);
    fireEvent.click(radios[2]);
    expect(onChange).toHaveBeenCalledWith(1);
  });
});
