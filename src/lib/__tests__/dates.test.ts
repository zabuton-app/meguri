// The dates the app shows are spelled in the APP language, not in the OS
// locale: everything around them is translated, so a date left to the OS is
// the one place the interface can disagree with itself.
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/lib/dates";

describe("dates", () => {
  // A fixed local date, so the expectation does not move with the clock.
  const date = new Date(2026, 9, 6, 15, 4);

  it("spell a date in the language they are given", () => {
    expect(formatDate(date, "en")).toBe(date.toLocaleDateString("en"));
    expect(formatDate(date, "ja")).toBe(date.toLocaleDateString("ja"));
  });

  it("spell a date and a time in the language they are given", () => {
    expect(formatDateTime(date, "en")).toBe(date.toLocaleString("en"));
    expect(formatDateTime(date, "ja")).toBe(date.toLocaleString("ja"));
  });

  it("say the same thing differently in two languages", () => {
    // Without this the two tests above would also pass if the language were
    // ignored and the OS locale used for both.
    expect(formatDate(date, "en")).not.toBe(formatDate(date, "ja"));
    expect(formatDateTime(date, "en")).not.toBe(formatDateTime(date, "ja"));
  });
});
