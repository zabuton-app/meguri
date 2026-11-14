import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDownloadOrigin } from "../downloadOrigin.js";

describe.skipIf(process.platform !== "darwin")(
  "recorded download origin",
  () => {
    let dir: string;
    let file: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "meguri-origin-"));
      file = join(dir, "before.png");
      writeFileSync(file, "");
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    function setAttribute(urls: string[]) {
      const plist = execFileSync(
        "/usr/bin/plutil",
        ["-convert", "binary1", "-o", "-", "-"],
        { input: JSON.stringify(urls) },
      );
      execFileSync("/usr/bin/xattr", [
        "-wx",
        "com.apple.metadata:kMDItemWhereFroms",
        plist.toString("hex"),
        file,
      ]);
    }

    it("preserves the recorded strings and roles through a rename", async () => {
      const download = "https://cdn.example.com/media.png?sig=Example%2bString";
      const referrer = "https://example.com/photos/123/";
      setAttribute([download, referrer]);
      const renamed = join(dir, "renamed.png");
      renameSync(file, renamed);
      expect(await readDownloadOrigin(renamed, dir)).toEqual([
        { kind: "download", url: download, hostname: "cdn.example.com" },
        { kind: "referrer", url: referrer, hostname: "example.com" },
      ]);
    });

    it("keeps the referrer label even when the download URL is unsafe", async () => {
      const referrer = "https://example.com/photos/123/";
      setAttribute(["file:///tmp/local.png", referrer]);
      expect(await readDownloadOrigin(file, dir)).toEqual([
        { kind: "referrer", url: referrer, hostname: "example.com" },
      ]);
    });

    it("hides missing records and paths outside the workspace", async () => {
      expect(await readDownloadOrigin(file, dir)).toEqual([]);
      setAttribute(["https://example.com/photos/123"]);
      const workspace = mkdtempSync(join(tmpdir(), "meguri-origin-workspace-"));
      try {
        const link = join(workspace, "outside.png");
        symlinkSync(file, link);
        expect(await readDownloadOrigin(link, workspace)).toEqual([]);
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });
  },
);
