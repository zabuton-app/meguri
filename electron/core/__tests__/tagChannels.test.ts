// The IPC payload contract for the tag channels. Creating a name and addressing
// one that already exists are validated at different limits on purpose: tags
// made before the creation cap existed still have to be renameable, mergeable
// and deletable, which is exactly what the tag screen is for.
import { describe, expect, it } from "vitest";
import { ChannelInputs } from "../../../shared/ipc/channels.js";
import {
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
