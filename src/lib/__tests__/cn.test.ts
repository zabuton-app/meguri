// cn() merges Tailwind v4 class names: tailwind-merge v2 only knew v3's (#290).
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("lets a later class override a v4 one of the same kind", () => {
    expect(cn("bg-linear-to-b", "bg-none")).toBe("bg-none");
    expect(cn("inset-shadow-sm", "inset-shadow-xs")).toBe("inset-shadow-xs");
  });

  it("keeps a background color beside a gradient", () => {
    expect(cn("bg-bg", "bg-linear-to-t")).toBe("bg-bg bg-linear-to-t");
  });
});
