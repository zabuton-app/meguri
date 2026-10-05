import { describe, expect, it } from "vitest";
import type { TagSummary } from "@/ipc/types";
import {
  CLOUD_MAX_FONT,
  CLOUD_MAX_LABEL,
  CLOUD_MAX_TAGS,
  CLOUD_MIN_FONT,
  cloudFontSize,
  cloudLabel,
  cloudWeight,
  layoutCloud,
  pickCloudTags,
} from "../cloudLayout";

function tag(namespace: string, name: string, fileCount: number): TagSummary {
  return {
    namespace,
    name,
    qualified: namespace ? `${namespace}:${name}` : name,
    fileCount,
    bySource: [
      { source: namespace ? "auto-meta" : "manual", count: fileCount },
    ],
    pipelineOwned: namespace !== "",
    workspaceIds: ["ws"],
  };
}

describe("pickCloudTags", () => {
  const tags = [
    tag("", "sunset", 3),
    tag("res", "4k", 40),
    tag("", "beach", 12),
    tag("", "orphan", 0),
    tag("", "alps", 3),
  ];

  it("keeps the user's own tags, most used first, ties by name", () => {
    const picked = pickCloudTags(tags, false);
    expect(picked.tags.map((t) => t.qualified)).toEqual([
      "beach",
      "alps",
      "sunset",
    ]);
    expect(picked.limited).toBe(false);
  });

  it("adds pipeline-owned tags on request", () => {
    expect(pickCloudTags(tags, true).tags[0].qualified).toBe("res:4k");
  });

  it("cuts the tail past the cap and says so", () => {
    const many = Array.from({ length: CLOUD_MAX_TAGS + 5 }, (_, i) =>
      tag("", `t${i}`, i + 1),
    );
    const picked = pickCloudTags(many, false);
    expect(picked.tags).toHaveLength(CLOUD_MAX_TAGS);
    expect(picked.limited).toBe(true);
    // The least used ones are the ones dropped.
    expect(picked.tags.at(-1)!.fileCount).toBe(6);
  });
});

describe("cloudWeight / cloudFontSize", () => {
  it("spans the font range between the least and most used tag", () => {
    expect(cloudFontSize(cloudWeight(1, 1, 100))).toBe(CLOUD_MIN_FONT);
    expect(cloudFontSize(cloudWeight(100, 1, 100))).toBe(CLOUD_MAX_FONT);
  });

  it("grows with the logarithm of the count", () => {
    // A tenth of the way up the range is already ~43% of the way up the scale.
    expect(cloudWeight(10, 1, 100)).toBeCloseTo(0.43, 2);
    expect(cloudWeight(10, 1, 100)).toBeLessThan(cloudWeight(50, 1, 100));
  });

  it("settles on the middle when every tag is used equally", () => {
    expect(cloudWeight(7, 7, 7)).toBe(0.5);
  });
});

describe("cloudLabel", () => {
  it("draws an ordinary name in full", () => {
    expect(cloudLabel("res:4k")).toBe("res:4k");
  });

  it("cuts an overlong name to the cap, counting glyphs not code units", () => {
    const label = cloudLabel("🏖".repeat(100));
    expect(Array.from(label)).toHaveLength(CLOUD_MAX_LABEL);
    expect(label.endsWith("…")).toBe(true);
  });
});

describe("layoutCloud", () => {
  const boxes = Array.from({ length: 60 }, (_, i) => ({
    width: 160 - i * 2,
    height: 40 - Math.floor(i / 2),
  }));

  it("places every box inside the reported bounds without overlap", () => {
    const { positions, width, height } = layoutCloud(boxes, 1.5);
    expect(positions).toHaveLength(boxes.length);
    positions.forEach((p, i) => {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + boxes[i].width).toBeLessThanOrEqual(width + 1e-6);
      expect(p.y + boxes[i].height).toBeLessThanOrEqual(height + 1e-6);
      for (let j = 0; j < i; j++) {
        const q = positions[j];
        const apart =
          p.x + boxes[i].width <= q.x ||
          q.x + boxes[j].width <= p.x ||
          p.y + boxes[i].height <= q.y ||
          q.y + boxes[j].height <= p.y;
        expect(apart).toBe(true);
      }
    });
  });

  it("puts the first box in the middle", () => {
    const { positions, width, height } = layoutCloud(boxes, 1);
    const cx = positions[0].x + boxes[0].width / 2;
    const cy = positions[0].y + boxes[0].height / 2;
    expect(Math.abs(cx - width / 2)).toBeLessThan(width / 4);
    expect(Math.abs(cy - height / 2)).toBeLessThan(height / 4);
  });

  it("follows the aspect ratio of the area", () => {
    const wide = layoutCloud(boxes, 3);
    const square = layoutCloud(boxes, 1);
    expect(wide.width / wide.height).toBeGreaterThan(
      square.width / square.height,
    );
  });

  it("returns an empty layout for no boxes", () => {
    expect(layoutCloud([])).toEqual({ positions: [], width: 0, height: 0 });
  });
});
