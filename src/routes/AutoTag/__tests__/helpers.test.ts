import { describe, expect, it } from "vitest";
import { folderFileIndexes, renameTag } from "@/routes/AutoTag/helpers";
import type { AutoTagFile } from "@shared/autoTag";

describe("renameTag", () => {
  const none = new Map<string, string>();

  it("renames in place, cleaning what was typed", () => {
    expect(renameTag(["Trip", "Harbor"], "Trip", "  Journey ", none)).toEqual({
      tags: ["Journey", "Harbor"],
      to: "Journey",
    });
  });

  it("takes the spelling the library already uses", () => {
    const existing = new Map([["journey", "JOURNEY"]]);
    expect(renameTag(["Trip"], "Trip", "journey", existing)).toEqual({
      tags: ["JOURNEY"],
      to: "JOURNEY",
    });
  });

  it("folds into a name the list holds already, in the list's spelling", () => {
    expect(renameTag(["Trip", "Port"], "Trip", "port", none)).toEqual({
      tags: ["Port"],
      to: "Port",
    });
  });

  it("changes nothing for the same name, an unusable one, or a tag not there", () => {
    expect(renameTag(["Trip"], "Trip", "Trip", none)).toBeNull();
    expect(renameTag(["Trip"], "Trip", "   ", none)).toBeNull();
    expect(renameTag(["Trip"], "Harbor", "Port", none)).toBeNull();
    // Another spelling of the library's tag is that tag: nothing to rename.
    expect(
      renameTag(["Trip"], "Trip", "TRIP", new Map([["trip", "Trip"]])),
    ).toBeNull();
  });
});

describe("folderFileIndexes", () => {
  const file = (workspaceId: string, folder: string): AutoTagFile => ({
    workspaceId,
    id: 1,
    name: "a.mp4",
    folder,
    metaKey: "k",
    tags: [],
  });

  it("is the files of the workspace under the folder, subfolders included", () => {
    const files = [
      file("ws", "Trips"),
      file("ws", "Trips/2024"),
      file("ws", "Trips2"),
      file("other", "Trips"),
      file("ws", ""),
    ];
    expect(
      folderFileIndexes(files, { workspaceId: "ws", folder: "Trips" }),
    ).toEqual([0, 1]);
    // The root is the whole workspace.
    expect(folderFileIndexes(files, { workspaceId: "ws", folder: "" })).toEqual(
      [0, 1, 2, 4],
    );
  });
});
