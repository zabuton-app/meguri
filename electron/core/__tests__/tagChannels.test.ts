// The IPC payload contract for the tag channels. Creating a name and addressing
// one that already exists are validated at different limits on purpose: tags
// made before the creation cap existed still have to be renameable, mergeable
// and deletable, which is exactly what the tag screen is for.
import { describe, expect, it } from "vitest";
import { ChannelInputs } from "../../../shared/ipc/channels.js";
import { MAX_WORKSPACE_ID } from "../../../shared/workspaceIds.js";
import {
  MAX_BULK_FILES,
  MAX_BULK_TAG_NAMES,
  MAX_TAG_LIST,
  MAX_TAG_NAME,
  MAX_TAG_REF_NAME,
} from "../../../shared/tags.js";

const legacy = "x".repeat(MAX_TAG_NAME + 1);
const ref = (name: string) => ({ namespace: "", name });

describe("tag channel payloads", () => {
  it("accepts an over-cap name where it only addresses an existing tag", () => {
    expect(
      ChannelInputs.tag_rename.safeParse({ from: ref(legacy), to: "beach" })
        .success,
    ).toBe(true);
    expect(
      ChannelInputs.tag_merge.safeParse({
        from: [ref(legacy)],
        into: ref("beach"),
      }).success,
    ).toBe(true);
    expect(
      ChannelInputs.tag_merge.safeParse({
        from: [ref("beach")],
        into: ref(legacy),
      }).success,
    ).toBe(true);
    expect(
      ChannelInputs.tag_delete.safeParse({ tags: [ref(legacy)] }).success,
    ).toBe(true);
  });

  it("caps a name the payload creates", () => {
    expect(
      ChannelInputs.tag_rename.safeParse({ from: ref("beach"), to: legacy })
        .success,
    ).toBe(false);
    expect(
      ChannelInputs.file_add_tag.safeParse({
        id: 1,
        workspaceId: "w1",
        name: legacy,
      }).success,
    ).toBe(false);
    expect(
      ChannelInputs.file_add_tag.safeParse({
        id: 1,
        workspaceId: "w1",
        name: "x".repeat(MAX_TAG_NAME),
      }).success,
    ).toBe(true);
  });

  it("bounds the operand lists by the catalog they are picked from", () => {
    // Every element costs a synchronous lookup, so an unbounded array is a way
    // to stall main from the renderer. The screen cannot select more than it
    // shows, and it never shows more than MAX_TAG_LIST.
    const refs = (n: number) =>
      Array.from({ length: n }, (_, i) => ref(`t${i}`));
    expect(
      ChannelInputs.tag_delete.safeParse({ tags: refs(MAX_TAG_LIST) }).success,
    ).toBe(true);
    expect(
      ChannelInputs.tag_delete.safeParse({ tags: refs(MAX_TAG_LIST + 1) })
        .success,
    ).toBe(false);
    expect(
      ChannelInputs.tag_merge.safeParse({
        from: refs(MAX_TAG_LIST + 1),
        into: ref("beach"),
      }).success,
    ).toBe(false);
  });

  it("still bounds a reference, so no unbounded string reaches a query", () => {
    expect(
      ChannelInputs.tag_delete.safeParse({
        tags: [ref("x".repeat(MAX_TAG_REF_NAME + 1))],
      }).success,
    ).toBe(false);
    expect(
      ChannelInputs.tag_delete.safeParse({ tags: [ref("")] }).success,
    ).toBe(false);
  });
});

describe("files_bulk_tag payloads", () => {
  const group = (fileIds: number[]) => ({ workspaceId: "ws", fileIds });
  const parse = (v: unknown) => ChannelInputs.files_bulk_tag.safeParse(v);

  it("accepts an edit grouped across workspaces", () => {
    expect(
      parse({
        targets: [group([1, 2]), { workspaceId: "other", fileIds: [3] }],
        add: ["beach"],
        remove: ["trip"],
      }).success,
    ).toBe(true);
  });

  it("refuses more files than one transaction may write", () => {
    const ids = Array.from({ length: MAX_BULK_FILES }, (_, i) => i + 1);
    expect(parse({ targets: [group(ids)], add: [], remove: [] }).success).toBe(
      true,
    );
    expect(
      parse({ targets: [group([...ids, 1e6])], add: [], remove: [] }).success,
    ).toBe(false);
    // Split across groups, the total is what counts.
    expect(
      parse({ targets: [group(ids), group([1e6])], add: [], remove: [] })
        .success,
    ).toBe(false);
  });

  it("refuses an oversized payload without validating its contents", () => {
    // 5,000 groups x 20,000 ids. Validating those one by one before refusing
    // takes seconds on the main process — with better-sqlite3 and the media
    // server on the same loop, that is the whole app frozen. The size gate
    // reads the raw shape and short-circuits, so this must be near-instant.
    const ids = Array.from({ length: 20_000 }, (_, i) => i + 1);
    const targets = Array.from({ length: MAX_BULK_FILES }, () => group(ids));
    const started = performance.now();
    expect(parse({ targets, add: [], remove: [] }).success).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("counts tag names across both lists against one budget", () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(
      parse({
        targets: [group([1])],
        add: names(MAX_BULK_TAG_NAMES),
        remove: [],
      }).success,
    ).toBe(true);
    expect(
      parse({
        targets: [group([1])],
        add: names(MAX_BULK_TAG_NAMES),
        remove: ["one-too-many"],
      }).success,
    ).toBe(false);
  });

  it("refuses a target group with no files at all", () => {
    expect(
      parse({ targets: [group([])], add: ["x"], remove: [] }).success,
    ).toBe(false);
    expect(parse({ targets: [], add: ["x"], remove: [] }).success).toBe(false);
  });
});

describe("bulk edit payloads shared by every selection channel", () => {
  const group = (fileIds: number[], workspaceId = "ws") => ({
    workspaceId,
    fileIds,
  });

  it("refuses an id long enough to be a payload of its own", () => {
    // The gate reads the raw value, so this is refused without the ids being
    // validated: a workspace id is a 16-character path hash.
    const long = "w".repeat(MAX_WORKSPACE_ID + 1);
    expect(
      ChannelInputs.files_bulk_meta.safeParse({
        targets: [group([1], long)],
        favorite: true,
      }).success,
    ).toBe(false);
  });

  it("refuses ids that cannot name a row", () => {
    for (const bad of [0, -1, 1.5]) {
      expect(
        ChannelInputs.files_bulk_meta.safeParse({
          targets: [group([bad])],
          favorite: true,
        }).success,
      ).toBe(false);
    }
  });
});

describe("files_bulk_meta payloads", () => {
  const targets = [{ workspaceId: "ws", fileIds: [1] }];
  const parse = (v: unknown) => ChannelInputs.files_bulk_meta.safeParse(v);

  it("takes either field, or both", () => {
    expect(parse({ targets, favorite: true }).success).toBe(true);
    expect(parse({ targets, rating: 3 }).success).toBe(true);
    expect(parse({ targets, favorite: false, rating: 0 }).success).toBe(true);
  });

  it("refuses a call that would set nothing", () => {
    expect(parse({ targets }).success).toBe(false);
  });

  it("holds the rating to a whole 0..5", () => {
    expect(parse({ targets, rating: 0 }).success).toBe(true);
    expect(parse({ targets, rating: 5 }).success).toBe(true);
    expect(parse({ targets, rating: 6 }).success).toBe(false);
    expect(parse({ targets, rating: -1 }).success).toBe(false);
    expect(parse({ targets, rating: 2.5 }).success).toBe(false);
  });
});

describe("collection_set_membership payloads", () => {
  const targets = [{ workspaceId: "ws", fileIds: [1] }];
  const parse = (v: unknown) =>
    ChannelInputs.collection_set_membership.safeParse(v);

  it("names the direction rather than taking a flag", () => {
    expect(parse({ collectionId: "c", targets, op: "add" }).success).toBe(true);
    expect(parse({ collectionId: "c", targets, op: "remove" }).success).toBe(
      true,
    );
    expect(parse({ collectionId: "c", targets, op: true }).success).toBe(false);
    expect(parse({ collectionId: "c", targets }).success).toBe(false);
  });

  it("caps the collection id", () => {
    expect(parse({ collectionId: "", targets, op: "add" }).success).toBe(false);
    expect(
      parse({
        collectionId: "c".repeat(MAX_WORKSPACE_ID + 1),
        targets,
        op: "add",
      }).success,
    ).toBe(false);
  });
});

describe("files_by_ids payloads", () => {
  const parse = (v: unknown) => ChannelInputs.files_by_ids.safeParse(v);

  it("takes the targets a bulk edit is sent with", () => {
    expect(
      parse({
        targets: [
          { workspaceId: "a", fileIds: [1, 2] },
          { workspaceId: "b", fileIds: [3] },
        ],
      }).success,
    ).toBe(true);
  });

  it("is held to the bulk-edit cap", () => {
    const fileIds = Array.from({ length: MAX_BULK_FILES + 1 }, (_, i) => i + 1);
    expect(parse({ targets: [{ workspaceId: "a", fileIds }] }).success).toBe(
      false,
    );
  });
});
