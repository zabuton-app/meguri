// Regression tests for the per-root storage path derivation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// paths.ts pulls the base dir from Electron's `app`; stub it for the test.
vi.mock("electron", () => ({ app: { getPath: () => "/base/userData" } }));

const {
  pathHash,
  dataDirForRoot,
  libraryDbPath,
  backupDbPathForDataDir,
  isInsideRoot,
  folderDirInsideRoot,
  folderPathUnderRoot,
  droppedDirectory,
} = await import("../paths.js");

describe("pathHash", () => {
  it("is a deterministic 16-hex-char digest", () => {
    const h = pathHash("/media/movies");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(pathHash("/media/movies")).toBe(h);
  });

  it("differs for different paths", () => {
    expect(pathHash("/media/a")).not.toBe(pathHash("/media/b"));
  });
});

describe("dataDirForRoot", () => {
  it("places artifacts under <userData>/roots/<hash>", () => {
    expect(dataDirForRoot("/media/movies")).toBe(
      `/base/userData/roots/${pathHash("/media/movies")}`,
    );
  });
});

describe("libraryDbPath", () => {
  it("places the shared library directly under <userData>", () => {
    expect(libraryDbPath()).toBe("/base/userData/library.sqlite");
  });
});

describe("backupDbPathForDataDir", () => {
  it("places the pre-merge copy next to the workspace DB", () => {
    expect(backupDbPathForDataDir("/base/userData/roots/abc")).toBe(
      "/base/userData/roots/abc/db.pre-shared-metadata.sqlite",
    );
  });
});

describe("isInsideRoot", () => {
  it("accepts paths inside the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    const file = path.join(root, "a.mp4");
    fs.writeFileSync(file, "x");
    try {
      expect(isInsideRoot(file, root)).toBe(true);
      expect(isInsideRoot(root, root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects sibling prefixes and paths that normalize outside the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-sib-"));
    const siblingFile = path.join(sibling, "a.mp4");
    fs.writeFileSync(siblingFile, "x");
    try {
      expect(isInsideRoot(siblingFile, root)).toBe(false);
      expect(isInsideRoot(path.join(root, "..", path.basename(sibling), "a.mp4"), root)).toBe(
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  it("rejects symlinks whose target lies outside the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-out-"));
    const target = path.join(outside, "secret.txt");
    const link = path.join(root, "link.txt");
    fs.writeFileSync(target, "secret");
    fs.symlinkSync(target, link);
    try {
      expect(isInsideRoot(link, root)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("accepts symlinks whose target stays inside the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    const target = path.join(root, "real.txt");
    const link = path.join(root, "link.txt");
    fs.writeFileSync(target, "ok");
    fs.symlinkSync(target, link);
    try {
      expect(isInsideRoot(link, root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns false when the path does not exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    try {
      expect(isInsideRoot(path.join(root, "missing.mp4"), root)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("folderDirInsideRoot", () => {
  it("resolves a folder path to its directory, the root included", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    fs.mkdirSync(path.join(root, "Movie", "2024"), { recursive: true });
    try {
      // Canonical paths: the tmp dir itself may sit behind a symlink.
      const real = fs.realpathSync(root);
      expect(folderDirInsideRoot(root, "")).toBe(real);
      expect(folderDirInsideRoot(root, "Movie/2024")).toBe(
        path.join(real, "Movie", "2024"),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses what is missing, not a directory, or leads outside", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-out-"));
    fs.writeFileSync(path.join(root, "a.mp4"), "x");
    fs.symlinkSync(outside, path.join(root, "escape"));
    try {
      expect(folderDirInsideRoot(root, "Gone")).toBeNull();
      expect(folderDirInsideRoot(root, "a.mp4")).toBeNull();
      expect(folderDirInsideRoot(root, "escape")).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("returns the link's target for a link that stays inside", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    fs.mkdirSync(path.join(root, "real"));
    fs.symlinkSync(path.join(root, "real"), path.join(root, "alias"));
    try {
      expect(folderDirInsideRoot(root, "alias")).toBe(
        path.join(fs.realpathSync(root), "real"),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses Windows separators and drive/stream colons in a segment", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    try {
      expect(folderDirInsideRoot(root, "a\\..\\b", "\\")).toBeNull();
      expect(folderDirInsideRoot(root, "C:", "\\")).toBeNull();
      expect(folderDirInsideRoot(root, "dir::$INDEX_ALLOCATION", "\\")).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("folderPathUnderRoot", () => {
  it("spells the folder under the root as configured", () => {
    expect(folderPathUnderRoot("/media/videos", "")).toBe("/media/videos");
    expect(folderPathUnderRoot("/media/videos", "Movie/2024")).toBe(
      path.join("/media/videos", "Movie", "2024"),
    );
  });
});

describe("droppedDirectory", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "meguri-drop-"));

  it("accepts an existing directory", async () => {
    const dir = tmp();
    try {
      expect(await droppedDirectory(dir)).toBe(fs.realpathSync(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a regular file", async () => {
    const dir = tmp();
    try {
      const file = path.join(dir, "clip.mp4");
      fs.writeFileSync(file, "");
      expect(await droppedDirectory(file)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a path that does not exist", async () => {
    const dir = tmp();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(await droppedDirectory(dir)).toBeNull();
  });

  it("rejects an empty or relative path", async () => {
    expect(await droppedDirectory("")).toBeNull();
    expect(await droppedDirectory("some/relative/dir")).toBeNull();
    expect(await droppedDirectory(".")).toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "resolves a symlink to the directory it points at",
    async () => {
      const dir = tmp();
      try {
        const target = path.join(dir, "target");
        const link = path.join(dir, "link");
        fs.mkdirSync(target);
        fs.symlinkSync(target, link);
        expect(await droppedDirectory(link)).toBe(fs.realpathSync(target));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
