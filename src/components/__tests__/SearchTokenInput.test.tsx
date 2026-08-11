// The search box treats an exact-tag directive as one indivisible thing: it
// becomes a chip once closed, is deleted whole, and never gets in the way of
// typing an ordinary word.
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/** Catalog entries the completion list draws from. */
function tag(name: string, fileCount: number, namespace = "") {
  return {
    namespace,
    name,
    qualified: namespace ? `${namespace}:${name}` : name,
    fileCount,
    bySource: [],
    pipelineOwned: namespace !== "",
    workspaceIds: ["ws-test"],
  };
}

const CATALOG = [
  tag("hoge", 7),
  tag("fuga", 3),
  tag("piyo", 5),
  tag("4k", 9, "res"),
];

const mocks = vi.hoisted(() => ({ tagsListAll: vi.fn() }));
vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () =>
      Promise.resolve({ ready: true, workspaceId: "ws-test", root: "/m" }),
    tagsListAll: (): Promise<unknown> =>
      mocks.tagsListAll() as Promise<unknown>,
  },
  ALL_ID: "__all__",
}));

const { SearchTokenInput } = await import("@/components/SearchTokenInput");
const { splitQueryChips } = await import("@/lib/searchTokens");
const { I18nProvider } = await import("@/i18n/I18nProvider");

/** Render the box the way FilterBar does: controlled, with the query lifted out. */
function setup(initial = "", catalog = CATALOG) {
  mocks.tagsListAll.mockResolvedValue({ tags: catalog, truncated: false });
  const seen = vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Harness({ children }: { children?: ReactNode }) {
    const [q, setQ] = useState(initial);
    return (
      <QueryClientProvider client={qc}>
        <I18nProvider>
          <SearchTokenInput
            id="list-search-input"
            value={q}
            onChange={(next) => {
              seen(next);
              setQ(next);
            }}
            placeholder="Search"
          />
          {children}
        </I18nProvider>
      </QueryClientProvider>
    );
  }
  render(<Harness />);
  const input = document.getElementById(
    "list-search-input",
  ) as HTMLInputElement;
  return { input, seen, last: () => seen.mock.calls.at(-1)?.[0] as string };
}

/** Type into the field with it focused, the way completion requires. */
function type(input: HTMLInputElement, value: string) {
  input.focus();
  fireEvent.change(input, { target: { value } });
}

function options() {
  return screen.queryAllByRole("option");
}

function chips(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-slot="search-chip"]'));
}

describe("splitQueryChips", () => {
  it("separates directives from free text", () => {
    expect(splitQueryChips('sunset tag:"beach house" meta:4k')).toEqual({
      chips: ["tag:beach house", "meta:4k"],
      text: "sunset",
    });
  });

  it("leaves a plain query alone", () => {
    expect(splitQueryChips("sunset 2024")).toEqual({
      chips: [],
      text: "sunset 2024",
    });
  });
});

describe("SearchTokenInput", () => {
  it("shows a directive from the outside as a chip, not as text", () => {
    const { input } = setup("meta:long");
    expect(screen.getByTitle("Length: Long")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("keeps a half-typed directive editable until a space closes it", () => {
    const { input, last } = setup();
    fireEvent.change(input, { target: { value: "tag:bea" } });
    // Chipping it here would pull the caret out of a word still being typed.
    expect(input.value).toBe("tag:bea");
    expect(screen.queryByTitle(/Tags:/)).toBeNull();

    fireEvent.change(input, { target: { value: "tag:beach " } });
    expect(screen.getByTitle("Tags: beach")).toBeTruthy();
    expect(input.value).toBe("");
    expect(last()).toBe("tag:beach");
  });

  it("chips a directive typed with a space after the colon", () => {
    const { input, last } = setup();
    fireEvent.change(input, { target: { value: "tag: " } });
    // Nothing to chip yet — the prefix alone is not a condition.
    expect(input.value).toBe("tag: ");
    expect(screen.queryByTitle(/Tags:/)).toBeNull();

    fireEvent.change(input, { target: { value: "tag: beach " } });
    expect(screen.getByTitle("Tags: beach")).toBeTruthy();
    expect(input.value).toBe("");
    expect(last()).toBe("tag:beach");
  });

  it("does not close a quoted phrase on the space inside it", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'tag:"beach ' } });
    expect(input.value).toBe('tag:"beach ');
    expect(screen.queryByTitle(/Tags:/)).toBeNull();

    fireEvent.change(input, { target: { value: 'tag:"beach house" ' } });
    expect(screen.getByTitle("Tags: beach house")).toBeTruthy();
  });

  it("re-quotes a chip value with a space when rebuilding the query", () => {
    const { input, last } = setup('tag:"beach house"');
    fireEvent.change(input, { target: { value: "sunset" } });
    // Losing the quotes here would split the tag into two tokens on the next read.
    expect(last()).toBe('tag:"beach house" sunset');
  });

  it("keeps typing space-separated words that are not directives", () => {
    const { input, last } = setup();
    fireEvent.change(input, { target: { value: "beach " } });
    // The trailing space has to survive, or the next word runs into this one.
    expect(input.value).toBe("beach ");
    fireEvent.change(input, { target: { value: "beach house" } });
    expect(last()).toBe("beach house");
  });

  it("leaves room to keep typing after a directive is chipped mid-sentence", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "sunset meta:4k " } });
    expect(screen.getByTitle("Resolution: 4k")).toBeTruthy();
    expect(input.value).toBe("sunset ");
  });

  it("does not append a space to the word the caret is in", () => {
    const { input } = setup();
    // Reachable by pasting: the directive is already closed but the last word
    // is not, and a space here would land between the caret and what precedes it.
    fireEvent.change(input, { target: { value: "meta:4k su" } });
    expect(screen.getByTitle("Resolution: 4k")).toBeTruthy();
    expect(input.value).toBe("su");
  });

  it("closes the pending directive on Enter", () => {
    const { input, last } = setup();
    fireEvent.change(input, { target: { value: "meta:long" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTitle("Length: Long")).toBeTruthy();
    expect(last()).toBe("meta:long");
  });

  it("deletes a chip whole from its own button", () => {
    const { input, last } = setup("meta:long sunset");
    fireEvent.click(
      within(screen.getByTitle("Length: Long")).getByRole("button"),
    );
    expect(last()).toBe("sunset");
    expect(input.value).toBe("sunset");
  });

  it("highlights the preceding chip on Backspace, then deletes it", () => {
    const { input, last, seen } = setup("tag:beach meta:long");
    fireEvent.keyDown(input, { key: "Backspace" });
    // A chip disappears with no undo, so the first Backspace only aims.
    expect(seen).not.toHaveBeenCalled();
    expect(chips()[1].dataset.selected).toBe("true");

    fireEvent.keyDown(input, { key: "Backspace" });
    // Whole, not one character of `meta:long` at a time.
    expect(last()).toBe("tag:beach");
    expect(screen.queryByTitle("Length: Long")).toBeNull();
  });

  it("does not reach for a chip when the caret is inside the text", () => {
    const { input, seen } = setup("tag:beach");
    fireEvent.change(input, { target: { value: "sun" } });
    input.setSelectionRange(3, 3);
    seen.mockClear();
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(seen).not.toHaveBeenCalled();
    expect(chips()[0].dataset.selected).toBeUndefined();
  });
});

describe("SearchTokenInput chip selection", () => {
  it("walks back onto the chips with ArrowLeft and forward with ArrowRight", () => {
    const { input } = setup("tag:beach meta:long");
    input.focus();

    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(chips()[1].dataset.selected).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(chips()[0].dataset.selected).toBe("true");
    expect(chips()[1].dataset.selected).toBeUndefined();

    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(chips()[1].dataset.selected).toBe("true");
  });

  it("stops at the left edge rather than wrapping round", () => {
    const { input } = setup("tag:beach meta:long");
    input.focus();
    for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(chips()[0].dataset.selected).toBe("true");
  });

  it("returns to the text when ArrowRight leaves the last chip", () => {
    const { input } = setup("tag:beach");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(chips()[0].dataset.selected).toBeUndefined();
  });

  it("ignores ArrowLeft while the caret is still inside the text", () => {
    const { input } = setup("tag:beach");
    input.focus();
    fireEvent.change(input, { target: { value: "sun" } });
    input.setSelectionRange(2, 2);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    // The caret has somewhere to go in the text; the chips are not it.
    expect(chips()[0].dataset.selected).toBeUndefined();
  });

  it("deletes the highlighted chip with Delete and keeps the highlight in place", () => {
    const { input, last } = setup("tag:beach meta:long tag:sea");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(chips()[1].dataset.selected).toBe("true");

    fireEvent.keyDown(input, { key: "Delete" });
    expect(last()).toBe("tag:beach tag:sea");
    // The chip that slid into the freed slot takes the highlight, so a second
    // Delete keeps removing from the same spot.
    expect(chips()[1].dataset.selected).toBe("true");
  });

  it("drops the highlight when the user goes back to typing", () => {
    const { input, seen } = setup("tag:beach");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(chips()[0].dataset.selected).toBe("true");

    fireEvent.keyDown(input, { key: "a" });
    expect(chips()[0].dataset.selected).toBeUndefined();
    expect(seen).not.toHaveBeenCalled();
  });

  it("drops the highlight on Escape without closing the field", () => {
    const { input } = setup("tag:beach");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(chips()[0].dataset.selected).toBeUndefined();
    expect(document.activeElement).toBe(input);
  });

  it("hides the suggestions while a chip is highlighted", async () => {
    const { input } = setup("tag:hoge");
    type(input, "tag:o");
    await waitFor(() => expect(options()).toHaveLength(2));

    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    // The caret is not in the text any more, so there is nothing to complete.
    expect(chips()[0].dataset.selected).toBe("true");
    expect(options()).toHaveLength(0);
  });
});

describe("SearchTokenInput completion", () => {
  it("offers tags containing the typed text, not only those starting with it", async () => {
    const { input } = setup();
    type(input, "tag:o");
    // "hoge" and "piyo" both contain an o; "fuga" does not.
    await waitFor(() => expect(options()).toHaveLength(2));
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining("hoge"),
      expect.stringContaining("piyo"),
    ]);
  });

  it("ranks a prefix match above a mid-word one", async () => {
    const { input } = setup("", [tag("hoge", 7), tag("shogun", 20)]);
    type(input, "tag:hog");
    await waitFor(() => expect(options()).toHaveLength(2));
    // "shogun" carries three times as many files, but "hoge" is what someone
    // typing "hog" almost certainly means.
    expect(options()[0].textContent).toContain("hoge");
    expect(options()[1].textContent).toContain("shogun");
  });

  it("offers the whole vocabulary right after the colon", async () => {
    const { input } = setup();
    type(input, "tag:");
    // Most-used first, so the list is useful before a single letter is typed.
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(options()[0].textContent).toContain("hoge");
  });

  it("keeps the two vocabularies apart", async () => {
    const { input } = setup();
    type(input, "meta:");
    // `tag:` addresses the user's own tags, `meta:` the generated ones; offering
    // a generated tag to `tag:` would be a condition that can never match.
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(options()[0].textContent).toContain("4k");
  });

  it("chips the accepted suggestion and clears the field", async () => {
    const { input, last } = setup();
    type(input, "tag:o");
    await waitFor(() => expect(options()).toHaveLength(2));
    fireEvent.click(options()[1]);

    expect(last()).toBe("tag:piyo");
    expect(screen.getByTitle("Tags: piyo")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("accepts the highlighted suggestion with the arrow keys and Enter", async () => {
    const { input, last } = setup();
    type(input, "tag:o");
    await waitFor(() => expect(options()).toHaveLength(2));

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(last()).toBe("tag:piyo");
  });

  it("leaves the free text in front of the completed directive alone", async () => {
    const { input, last } = setup();
    type(input, "sunset tag:hog");
    await waitFor(() => expect(options()).toHaveLength(1));
    fireEvent.click(options()[0]);
    expect(last()).toBe("tag:hoge sunset");
  });

  it("offers nothing for ordinary free text", () => {
    const { input } = setup();
    type(input, "hog");
    // Free text goes to the full-text index; a tag list would be noise there.
    expect(options()).toHaveLength(0);
  });

  it("closes on Escape but keeps the field focused to finish by hand", async () => {
    const { input } = setup();
    type(input, "tag:o");
    await waitFor(() => expect(options()).toHaveLength(2));

    fireEvent.keyDown(input, { key: "Escape" });
    expect(options()).toHaveLength(0);
    expect(input.value).toBe("tag:o");
    expect(document.activeElement).toBe(input);
  });

  it("closes when the field loses focus", async () => {
    const { input } = setup();
    type(input, "tag:o");
    await waitFor(() => expect(options()).toHaveLength(2));
    fireEvent.blur(input);
    expect(options()).toHaveLength(0);
  });
});
