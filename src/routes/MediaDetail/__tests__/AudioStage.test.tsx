// The stage's spectrum toggle: flips the same preference Settings holds, so
// the display comes and goes with it, and is inert under the OS
// reduce-motion setting (which overrides the preference).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { AudioStage } from "@/routes/MediaDetail/AudioStage";
import { renderWithProviders } from "@/test/renderWithProviders";
import {
  defaultAppStatus,
  sampleAudioRow,
  sampleFileDetail,
  WS_ID,
} from "@/test/fixtures";
import type { FileDetail } from "@/ipc/types";

const mocks = vi.hoisted(() => ({ appStatus: vi.fn() }));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: (): Promise<unknown> => mocks.appStatus() as Promise<unknown>,
  },
  ALL_ID: "__all__",
}));

vi.mock("@/lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const audioDetail: FileDetail = {
  ...sampleFileDetail,
  ...sampleAudioRow,
  absPath: "/media/music/track.mp3",
};

beforeEach(() => {
  mocks.appStatus.mockReset().mockResolvedValue(defaultAppStatus);
  localStorage.clear();
  // No Web Audio in jsdom: the display renders its canvas and draws nothing.
  vi.stubGlobal("AudioContext", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderStage() {
  return renderWithProviders(
    <AudioStage
      file={audioDetail}
      wsId={WS_ID}
      mediaBase="http://127.0.0.1:1"
      coverSrc={null}
    />,
  );
}

describe("AudioStage spectrum toggle", () => {
  it("hides and shows the spectrum, and persists the choice", () => {
    renderStage();
    expect(screen.queryByTestId("audio-spectrum")).not.toBeNull();
    const toggle = screen.getByRole("button", { name: "Hide spectrum" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(screen.queryByTestId("audio-spectrum")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Show spectrum" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      (
        JSON.parse(localStorage.getItem("meguri.prefs")!) as {
          audioSpectrum: boolean;
        }
      ).audioSpectrum,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Show spectrum" }));
    expect(screen.queryByTestId("audio-spectrum")).not.toBeNull();
  });

  it("is disabled under the OS reduce-motion setting", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderStage();
    expect(screen.queryByTestId("audio-spectrum")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Hide spectrum" });
    expect(toggle).toHaveProperty("disabled", true);
  });
});
