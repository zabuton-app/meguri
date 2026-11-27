// Audio gets a thumbnail only when the file embeds cover art. Without one the
// fallback icon is its only visual representation — it must be the audio icon,
// not the image icon, and never a broken <img>. With one it renders like any
// other thumbnail, but must not gain the video-only affordances.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PreferencesProvider } from "@/settings/PreferencesProvider";
import { I18nProvider } from "@/i18n/I18nProvider";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import {
  sampleAudioRow,
  sampleAudioRowWithCover,
  sampleFileRow,
} from "@/test/fixtures";
import type { FileRow } from "@/ipc/types";

function renderThumb(
  file: FileRow,
  fit?: "cover" | "contain",
): ReturnType<typeof render> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <PreferencesProvider>
          <MediaThumbnail
            file={file}
            mediaBase="http://127.0.0.1:17345"
            version={0}
            fit={fit}
          />
        </PreferencesProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

/** lucide-react tags each icon with a `lucide-<name>` class. */
function iconNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll("svg")].flatMap((svg) =>
    [...svg.classList].filter((c) => c.startsWith("lucide-")),
  );
}

describe("MediaThumbnail", () => {
  it("announces how far an in-progress file got", () => {
    const { getByRole } = renderThumb({
      ...sampleFileRow,
      resumePosition: 30,
      progress: 0.254,
    });
    const bar = getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-label")).toBeTruthy();
  });

  it("covers its box by default and shows the whole image when asked to contain", () => {
    const img = (fit?: "cover" | "contain") =>
      renderThumb(sampleFileRow, fit).container.querySelector("img")!.className;
    expect(img()).toContain("object-cover");
    expect(img("contain")).toContain("object-contain");
    expect(img("contain")).not.toContain("object-cover");
  });

  it("shows no progress bar for a file with nothing to resume", () => {
    const { queryByRole } = renderThumb(sampleFileRow);
    expect(queryByRole("progressbar")).toBeNull();
  });

  it("renders the audio icon for an audio row that has no thumbnail", () => {
    const { container } = renderThumb(sampleAudioRow);
    const names = iconNames(container);
    expect(names.some((n) => n.includes("music"))).toBe(true);
    // Not the image fallback, and no <img> that would render broken.
    expect(names.some((n) => n.includes("image"))).toBe(false);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the extracted cover art for an audio row that has one", () => {
    const { container } = renderThumb(sampleAudioRowWithCover);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      `http://127.0.0.1:17345/ws/${sampleAudioRowWithCover.workspaceId}/thumb/${sampleAudioRowWithCover.id}?v=0`,
    );
    expect(iconNames(container).some((n) => n.includes("music"))).toBe(false);
  });

  it("keeps the play overlay video-only even when audio has a cover", () => {
    // A cover is a single still: the play overlay and the hover scrub preview
    // (which needs the frame endpoint) must not appear on it.
    const { container } = renderThumb(sampleAudioRowWithCover);
    expect(iconNames(container).some((n) => n.includes("play"))).toBe(false);
  });

  it("falls back to the icon when thumb_status is done but no file was produced", () => {
    // The regression this guards: keying on thumbStatus alone would build a URL
    // that 404s for cover-less audio.
    const { container } = renderThumb({
      ...sampleAudioRow,
      thumbStatus: "done",
      hasThumb: 0,
    });
    expect(container.querySelector("img")).toBeNull();
    expect(iconNames(container).some((n) => n.includes("music"))).toBe(true);
  });

  it("falls back to the icon when a recorded thumbnail fails to load", () => {
    // hasThumb is 1 but the file is gone (deleted thumbs dir, stale row). Without
    // an onError fallback the image stays at opacity-0 over the skeleton forever.
    const { container } = renderThumb(sampleAudioRowWithCover);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector("img")).toBeNull();
    expect(iconNames(container).some((n) => n.includes("music"))).toBe(true);
  });

  it("still renders the image icon for an image row without a thumbnail", () => {
    const { container } = renderThumb({
      ...sampleFileRow,
      kind: "image",
      thumbStatus: "error",
    });
    const names = iconNames(container);
    expect(names.some((n) => n.includes("image"))).toBe(true);
    expect(names.some((n) => n.includes("music"))).toBe(false);
  });
});
