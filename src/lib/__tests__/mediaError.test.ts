import { describe, expect, it } from "vitest";
import { isFatalMediaError, MEDIA_ERR_ABORTED } from "@/lib/mediaError";

describe("isFatalMediaError", () => {
  it("treats only a real failure as fatal", () => {
    expect(isFatalMediaError(null)).toBe(false);
    // A load interrupted by the player's own src swap / load().
    expect(isFatalMediaError({ code: MEDIA_ERR_ABORTED } as MediaError)).toBe(
      false,
    );
    for (const code of [2, 3, 4])
      expect(isFatalMediaError({ code } as MediaError)).toBe(true);
  });
});
