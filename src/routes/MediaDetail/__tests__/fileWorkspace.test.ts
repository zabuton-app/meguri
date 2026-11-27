import { describe, expect, it } from "vitest";
import { ALL_ID } from "@/ipc/client";
import { COLLECTION_ID_PREFIX } from "@shared/workspaceIds";
import { fileWorkspaceId } from "../fileWorkspace";

describe("fileWorkspaceId", () => {
  it("takes the workspace the URL names", () => {
    expect(fileWorkspaceId("ws-b", "ws-a")).toBe("ws-b");
  });

  it("falls back to the active workspace", () => {
    expect(fileWorkspaceId(null, "ws-a")).toBe("ws-a");
    expect(fileWorkspaceId(null, undefined)).toBe("");
  });

  it("does not fall back to the All or a collection view", () => {
    expect(fileWorkspaceId(null, ALL_ID)).toBe("");
    expect(fileWorkspaceId(null, `${COLLECTION_ID_PREFIX}c1`)).toBe("");
  });
});
