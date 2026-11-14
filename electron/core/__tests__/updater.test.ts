import { beforeEach, describe, expect, it } from "vitest";
import {
  compareVersions,
  releasesPage,
  configureUpdater,
  updateDownloadUrl,
} from "../updater.js";

// The repo and the Store product ID are module state set at startup; reset
// them so no test sees another's.
beforeEach(() =>
  configureUpdater({
    repo: { owner: "zabuton-app", name: "meguri" },
    msStoreProductId: "9NRSM11RRH8Z",
    envPrefix: "MEGURI",
  }),
);

describe("compareVersions", () => {
  it("treats equal versions as 0", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  it("detects a newer version", () => {
    expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.10", "1.2.9")).toBeGreaterThan(0);
  });

  it("detects an older version", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.3.0")).toBeLessThan(0);
  });

  it("ignores a leading v and is case-insensitive", () => {
    expect(compareVersions("v0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("V1.0.0", "v1.0.0")).toBe(0);
  });

  it("treats missing components as 0", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1", "1.0.1")).toBeLessThan(0);
  });

  it("drops a pre-release suffix and compares the core", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
    expect(compareVersions("1.1.0-rc1", "1.0.0")).toBeGreaterThan(0);
  });

  it("tolerates non-numeric garbage by treating it as 0", () => {
    expect(compareVersions("1.x.0", "1.0.0")).toBe(0);
  });
});

describe("updateDownloadUrl", () => {
  const htmlUrl = "https://github.com/zabuton-app/meguri/releases/tag/v9.9.9";

  it("uses the release page URL for non-Store installs", () => {
    expect(updateDownloadUrl(htmlUrl, false)).toBe(htmlUrl);
  });

  it("falls back to the releases list when no release URL is given", () => {
    expect(updateDownloadUrl(null, false)).toBe(releasesPage());
    expect(updateDownloadUrl("", false)).toBe(releasesPage());
  });

  it("points Store installs at the Store product page, even with a release URL", () => {
    expect(updateDownloadUrl(htmlUrl, true)).toBe(
      "ms-windows-store://pdp/?ProductId=9NRSM11RRH8Z",
    );
    expect(updateDownloadUrl(null, true)).toBe(
      "ms-windows-store://pdp/?ProductId=9NRSM11RRH8Z",
    );
  });

  it("uses the product ID the app was started with", () => {
    configureUpdater({
      repo: { owner: "someone", name: "other-app" },
      msStoreProductId: "9ABCDEFGHIJK",
      envPrefix: "OTHER",
    });
    expect(updateDownloadUrl(htmlUrl, true)).toBe(
      "ms-windows-store://pdp/?ProductId=9ABCDEFGHIJK",
    );
  });

  it("sends Store installs to GitHub when the app has no product ID", () => {
    configureUpdater({
      repo: { owner: "someone", name: "other-app" },
      envPrefix: "OTHER",
    });
    expect(updateDownloadUrl(htmlUrl, true)).toBe(htmlUrl);
    expect(updateDownloadUrl(null, true)).toBe(
      "https://github.com/someone/other-app/releases",
    );
  });
});

describe("releasesPage", () => {
  it("points at the repository the app was started with", () => {
    configureUpdater({
      repo: { owner: "someone", name: "other-app" },
      envPrefix: "OTHER",
    });
    expect(releasesPage()).toBe(
      "https://github.com/someone/other-app/releases",
    );
  });
});
