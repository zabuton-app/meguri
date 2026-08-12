// The add-a-tag field. A name the IPC layer would refuse has to be refused
// here instead: main's rejection reaches the user as a raw Zod message, and an
// Enter that does nothing at all is worse still.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MAX_TAG_NAME } from "@shared/tags";

vi.mock("@/ipc/client", () => ({
  api: { tagsList: (): Promise<string[]> => Promise.resolve([]) },
  ALL_ID: "__all__",
}));

const { TagEditor } = await import("@/components/TagEditor");
const { I18nProvider } = await import("@/i18n/I18nProvider");

function setup() {
  const onAdd = vi.fn();
  render(
    <I18nProvider>
      <TagEditor tags={[]} workspaceId="ws" onAdd={onAdd} onRemove={vi.fn()} />
    </I18nProvider>,
  );
  const input = screen.getByPlaceholderText<HTMLInputElement>(
    "Add a tag and press Enter",
  );
  return { input, onAdd };
}

describe("TagEditor", () => {
  it("adds a name within the cap on Enter", () => {
    const { input, onAdd } = setup();
    fireEvent.change(input, { target: { value: "  beach  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("beach");
    expect(input.value).toBe("");
  });

  it("caps typing at the length main accepts", () => {
    const { input } = setup();
    expect(input.maxLength).toBe(MAX_TAG_NAME);
  });

  it("says why rather than dropping an over-long name silently", () => {
    const { input, onAdd } = setup();
    fireEvent.change(input, {
      target: { value: "x".repeat(MAX_TAG_NAME + 1) },
    });

    expect(screen.getByText(/at most 64 characters/)).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
    // The text stays put so it can be shortened instead of retyped.
    expect(input.value).toHaveLength(MAX_TAG_NAME + 1);
  });
});
