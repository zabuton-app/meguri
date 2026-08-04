// Audio has no thumbnail by design, so the fallback icon is its only visual
// representation in the library — it must be the audio icon, not the image
// icon, and never a broken <img>.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PreferencesProvider } from "@/settings/PreferencesProvider";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { sampleAudioRow, sampleFileRow } from "@/test/fixtures";
import type { FileRow } from "@/ipc/types";

function renderThumb(file: FileRow): ReturnType<typeof render> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <PreferencesProvider>
        <MediaThumbnail
          file={file}
          mediaBase="http://127.0.0.1:17345"
          version={0}
        />
      </PreferencesProvider>
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
  it("renders the audio icon for an audio row that has no thumbnail", () => {
    const { container } = renderThumb(sampleAudioRow);
    const names = iconNames(container);
    expect(names.some((n) => n.includes("music"))).toBe(true);
    // Not the image fallback, and no <img> that would render broken.
    expect(names.some((n) => n.includes("image"))).toBe(false);
    expect(container.querySelector("img")).toBeNull();
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
