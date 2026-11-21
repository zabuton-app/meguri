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

  it("lets a radius or font size passed in override a token of the same kind", () => {
    expect(cn("rounded-control", "rounded-full")).toBe("rounded-full");
    expect(cn("rounded-item", "rounded-none")).toBe("rounded-none");
    expect(cn("text-xs", "text-2xs")).toBe("text-2xs");
  });

  it("keeps a text color beside text-2xs", () => {
    expect(cn("text-2xs", "text-muted")).toBe("text-2xs text-muted");
  });
});
