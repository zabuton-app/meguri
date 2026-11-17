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

const mocks = vi.hoisted(() => ({
  tagsListAll: vi.fn(),
  workspaceId: "ws-test",
}));
vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () =>
      Promise.resolve({
        ready: true,
        workspaceId: mocks.workspaceId,
        root: "/m",
      }),
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
  mocks.workspaceId = "ws-test";
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
  return {
    input,
    qc,
    seen,
    last: () => seen.mock.calls.at(-1)?.[0] as string,
  };
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
    expect(splitQueryChips('sunset tag:"beach house" tag:4k')).toEqual({
      chips: ["tag:beach house", "tag:4k"],
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
    const { input } = setup("tag:long");
    expect(screen.getByTitle("Length: Long")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("shows a generated tag's chip as its category and value (#468)", () => {
    setup("tag:audio_tempo:fast tag:long tag:beach");
    expect(chips().map((c) => c.textContent)).toEqual([
      "Tempo: Fast",
      "Length: Long",
      "tag:beach",
    ]);
  });

  it("chips a hash: directive, and leaves a short one as text (#302)", () => {
    const { input, last } = setup();
    type(input, "hash:3FA9c1d2 hash:3f ");
    expect(chips().map((c) => c.textContent)).toEqual(["hash:3fa9c1d2"]);
    expect(input.value).toBe("hash:3f ");
    expect(last()).toBe("hash:3FA9c1d2 hash:3f");
  });

  it("chips an ext: directive once closed, and repeats are added once (#522)", () => {
    const { input, last } = setup();
    type(input, "ext:MP4 ext:mp4 ");
    expect(chips().map((c) => c.textContent)).toEqual(["ext:mp4"]);
    expect(input.value).toBe("");
    expect(last()).toBe("ext:MP4");
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
    fireEvent.change(input, { target: { value: "sunset tag:4k " } });
    expect(screen.getByTitle("Resolution: 4k")).toBeTruthy();
    expect(input.value).toBe("sunset ");
  });

  it("does not append a space to the word the caret is in", () => {
    const { input } = setup();
    // Reachable by pasting: the directive is already closed but the last word
    // is not, and a space here would land between the caret and what precedes it.
    fireEvent.change(input, { target: { value: "tag:4k su" } });
    expect(screen.getByTitle("Resolution: 4k")).toBeTruthy();
    expect(input.value).toBe("su");
  });

  it("closes the pending directive on Enter", () => {
    const { input, last } = setup();
    fireEvent.change(input, { target: { value: "tag:long" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTitle("Length: Long")).toBeTruthy();
    expect(last()).toBe("tag:long");
  });

  it("deletes a chip whole from its own button", () => {
    const { input, last } = setup("tag:long sunset");
    fireEvent.click(
      within(screen.getByTitle("Length: Long")).getByRole("button"),
    );
    expect(last()).toBe("sunset");
    expect(input.value).toBe("sunset");
  });

  it("highlights the preceding chip on Backspace, then deletes it", () => {
    const { input, last, seen } = setup("tag:beach tag:long");
    fireEvent.keyDown(input, { key: "Backspace" });
    // A chip disappears with no undo, so the first Backspace only aims.
    expect(seen).not.toHaveBeenCalled();
    expect(chips()[1].dataset.selected).toBe("true");

    fireEvent.keyDown(input, { key: "Backspace" });
    // Whole, not one character of `tag:long` at a time.
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
    const { input } = setup("tag:beach tag:long");
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
    const { input } = setup("tag:beach tag:long");
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
    const { input, last } = setup("tag:beach tag:long tag:sea");
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

  it("highlights the chip a click lands on", () => {
    const { input, seen } = setup("tag:beach tag:long");
    fireEvent.click(chips()[0]);
    // Mouse parity with ArrowLeft: aim at the condition, do not remove it.
    expect(chips()[0].dataset.selected).toBe("true");
    expect(seen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("removes rather than highlights when the click is on the chip's cross", () => {
    const { last } = setup("tag:beach tag:long");
    fireEvent.click(within(chips()[1]).getByRole("button"));
    expect(last()).toBe("tag:beach");
    expect(chips()[0].dataset.selected).toBeUndefined();
  });

  it("points at the chip a token already occupies", async () => {
    const { input, seen } = setup("tag:beach");
    const { highlightSearchToken } = await import("@/lib/ui-events");
    // Clicking a tag that is already a condition changes nothing, so the box is
    // asked to answer "it is already on" instead of looking dead.
    highlightSearchToken('tag:"beach"');
    await waitFor(() => expect(chips()[0].dataset.selected).toBe("true"));
    expect(seen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("ignores a highlight for a token it does not carry", async () => {
    setup("tag:beach");
    const { highlightSearchToken } = await import("@/lib/ui-events");
    highlightSearchToken("tag:sunset");
    await waitFor(() => expect(chips()[0].dataset.selected).toBeUndefined());
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

  it("offers a tag held only in another workspace, saying so, after the ones here", async () => {
    const { input } = setup("", [
      ...CATALOG,
      { ...tag("hotel", 20), workspaceIds: ["ws-other"] },
    ]);
    type(input, "tag:ho");
    await waitFor(() => expect(options()).toHaveLength(2));
    // The whole library was asked for, not the view.
    expect(mocks.tagsListAll).toHaveBeenCalled();
    // "hotel" is the better match and the more used, but it is not here.
    expect(options().map((o) => o.textContent)).toEqual([
      "tag:hoge7",
      "tag:hotelother workspaces only20",
    ]);
    fireEvent.click(options()[1]);
    expect(chips().map((c) => c.textContent)).toEqual(["tag:hotel"]);
  });

  it("asks for the catalog again when the view changes", async () => {
    // Past the cap the main process keeps the view's own tags first, so the
    // catalog fetched for one workspace is not the one for another.
    const { input, qc } = setup();
    type(input, "tag:ho");
    await waitFor(() => expect(options()).toHaveLength(1));
    const before = mocks.tagsListAll.mock.calls.length;

    mocks.workspaceId = "ws-other";
    mocks.tagsListAll.mockResolvedValue({
      tags: [{ ...tag("hotel", 2), workspaceIds: ["ws-other"] }],
      truncated: false,
    });
    await qc.refetchQueries({ queryKey: ["app_status"] });

    await waitFor(() =>
      expect(mocks.tagsListAll.mock.calls.length).toBeGreaterThan(before),
    );
    await waitFor(() =>
      expect(options().map((o) => o.textContent)).toEqual(["tag:hotel2"]),
    );
  });

  it("does not chip a condition the box already carries", () => {
    const { input, last } = setup("tag:4k");
    // Same rule the click path follows: a condition already on stays on once.
    fireEvent.change(input, { target: { value: "tag:4k " } });
    expect(chips()).toHaveLength(1);
    expect(input.value).toBe("");
    expect(last()).toBe("tag:4k");
  });

  it("treats a differently-cased repeat as the same condition", () => {
    const { input } = setup("tag:4k");
    fireEvent.change(input, { target: { value: "tag:4K " } });
    expect(chips()).toHaveLength(1);
  });

  it("collapses a directive repeated within one paste", () => {
    const { input, last } = setup();
    fireEvent.change(input, { target: { value: "tag:4k sunset tag:4k " } });
    expect(chips()).toHaveLength(1);
    expect(last()).toBe("tag:4k sunset");
  });

  it("keeps the free text when the only directive was a repeat", () => {
    const { input, last } = setup("tag:4k");
    fireEvent.change(input, { target: { value: "tag:4k sunset " } });
    // The repeat is dropped rather than left behind as text, which would give
    // the substring search over file names the directive exists to avoid.
    expect(chips()).toHaveLength(1);
    expect(input.value).toBe("sunset ");
    expect(last()).toBe("tag:4k sunset");
  });

  it("points at the chip a typed repeat lands on", () => {
    const { input } = setup("tag:beach tag:4k");
    fireEvent.change(input, { target: { value: "tag:4k " } });
    // Parity with a redundant click, which asks the box to aim at the chip
    // instead of looking as though the typing went nowhere.
    expect(chips()[1].dataset.selected).toBe("true");
    expect(chips()[0].dataset.selected).toBeUndefined();
  });

  it("leaves the highlight off when the directive was actually added", () => {
    const { input } = setup("tag:beach");
    fireEvent.change(input, { target: { value: "tag:4k " } });
    expect(chips()).toHaveLength(2);
    expect(chips().every((chip) => !chip.dataset.selected)).toBe(true);
  });

  it("stays in the field when Enter closes a repeat", () => {
    const { input } = setup("tag:beach tag:4k");
    input.focus();
    fireEvent.change(input, { target: { value: "tag:4k" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Blurring here would clear the highlight that says where the condition
    // went, leaving the box looking as though it swallowed the typing.
    expect(chips()[1].dataset.selected).toBe("true");
    expect(document.activeElement).toBe(input);
  });

  it("still leaves the field when Enter closes something new", () => {
    const { input } = setup("tag:beach");
    input.focus();
    fireEvent.change(input, { target: { value: "tag:4k" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chips()).toHaveLength(2);
    expect(document.activeElement).not.toBe(input);
  });

  it("does not let a repeat's highlight double as a delete confirmation", () => {
    const { input, last } = setup("tag:beach tag:4k");
    fireEvent.change(input, { target: { value: "tag:4k " } });
    expect(chips()[1].dataset.selected).toBe("true");

    // The natural next keystroke after "my typing vanished" is Backspace, and
    // it must not take a condition with it on the first press.
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(chips()).toHaveLength(2);
    // Now it is armed, exactly as a chip walked onto with the arrow keys.
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(chips()).toHaveLength(1);
    expect(last()).toBe("tag:beach");
  });

  it("keeps deleting in one press from a chip the user aimed at", () => {
    const { input, last } = setup("tag:beach tag:4k");
    input.focus();
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(last()).toBe("tag:beach");
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
    // Most-used first, and both kinds together — the generated res:4k outranks
    // every manual tag here on file count.
    await waitFor(() => expect(options()).toHaveLength(4));
    expect(options()[0].textContent).toContain("4k");
    expect(options()[1].textContent).toContain("hoge");
  });

  it("offers generated tags from the same directive", async () => {
    const { input } = setup();
    type(input, "tag:4");
    // One directive covers both kinds, so the generated res:4k is reachable
    // without a second prefix to remember.
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

  it("does not chip a completed suggestion the box already carries", async () => {
    const { input, last } = setup("tag:piyo");
    type(input, "tag:o");
    await waitFor(() => expect(options()).toHaveLength(2));
    // Completing something already on is the third route into the query, and it
    // goes through apply() like the other two.
    fireEvent.click(options()[1]);

    expect(chips()).toHaveLength(1);
    expect(chips()[0].dataset.selected).toBe("true");
    expect(input.value).toBe("");
    expect(last()).toBe("tag:piyo");
  });

  it("accepts the highlighted suggestion with the arrow keys and Enter", async () => {
    const { input, last } = setup();
    type(input, "tag:o");
    await waitFor(() => expect(options()).toHaveLength(2));

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(last()).toBe("tag:piyo");
  });

  it("completes on Tab and keeps the caret in the field", async () => {
    const { input, last } = setup();
    type(input, "tag:o");
    await waitFor(() => expect(options()).toHaveLength(2));

    const prevented = !fireEvent.keyDown(input, { key: "Tab" });
    expect(last()).toBe("tag:hoge");
    // The default would move focus away mid-query.
    expect(prevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(options()).toHaveLength(0);
  });

  it("leaves Shift+Tab alone so it can still move focus back", async () => {
    const { input, seen } = setup();
    type(input, "tag:o");
    await waitFor(() => expect(options()).toHaveLength(2));

    seen.mockClear();
    const prevented = !fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(prevented).toBe(false);
    expect(seen).not.toHaveBeenCalled();
  });

  it("leaves Tab alone when there is nothing to complete", () => {
    const { input, seen } = setup();
    type(input, "sunset");
    const prevented = !fireEvent.keyDown(input, { key: "Tab" });
    expect(prevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
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

describe("SearchTokenInput pointer after tag:", () => {
  it("moves the one highlight with the pointer, as before (#542)", async () => {
    const { input } = setup();
    type(input, "tag:");
    await waitFor(() => expect(options().length).toBeGreaterThan(2));
    fireEvent.mouseMove(options()[2]);
    const selected = options().filter(
      (o) => o.getAttribute("aria-selected") === "true",
    );
    expect(selected).toEqual([options()[2]]);
    expect(options()[0].className).not.toContain("hover:");
  });
});

describe("SearchTokenInput closed value sets (#468)", () => {
  it("offers every value of a closed set, those no file carries yet after", async () => {
    const { input } = setup("", [...CATALOG, tag("lossy", 5, "audio_quality")]);
    type(input, "tag:audio_quality:");
    // Once the catalog is in, the one held comes first with its count.
    await waitFor(() =>
      expect(options()[0]?.textContent).toMatch(/^tag:lossy.*5$/),
    );
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^tag:lossy.*5$/),
      // The rest by name.
      expect.stringMatching(/^tag:hires.*0$/),
      expect.stringMatching(/^tag:lossless.*0$/),
    ]);
  });

  it("searches for a value picked though no file carries it", async () => {
    const { input, last } = setup();
    type(input, "tag:audio_ch:ster");
    await waitFor(() => expect(options()).toHaveLength(1));
    fireEvent.click(options()[0]);
    expect(last()).toBe("tag:audio_ch:stereo");
  });
});

describe("SearchTokenInput tag suggestions for an ordinary word (#542)", () => {
  const catalog = [...CATALOG, tag("jazz", 12, "audio_genre"), tag("jazz", 3)];
  const texts = () => options().map((o) => o.textContent);
  const selected = () =>
    options().findIndex((o) => o.getAttribute("aria-selected") === "true");
  /** Type `word` once the catalog is in, so an empty list means something. */
  async function ready(input: HTMLInputElement) {
    type(input, "jazz");
    await waitFor(() => expect(options()).toHaveLength(3));
  }

  it("offers the word's own search first, chosen, then the tags it matches", async () => {
    const { input } = setup("", catalog);
    await ready(input);
    expect(texts()[0]).toBe("Search for “jazz”");
    expect(texts()[1]).toContain("Genre: jazz");
    expect(texts()[2]).toMatch(/^tag:jazz/);
    expect(selected()).toBe(0);
  });

  it("searches for the word on Enter, as without the list", async () => {
    const { input, last } = setup("", catalog);
    await ready(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chips()).toHaveLength(0);
    expect(last()).toBe("jazz");
  });

  it("takes the tag the arrow keys went to, in place of the word", async () => {
    const { input, last } = setup("", catalog);
    type(input, "sunset jazz");
    await waitFor(() => expect(options()).toHaveLength(3));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toBe(1);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chips().map((c) => c.textContent)).toEqual(["Genre: jazz"]);
    expect(last()).toBe("tag:audio_genre:jazz sunset");
  });

  it("moves the choice with the pointer, which is always the row Enter takes", async () => {
    const { input } = setup("", catalog);
    await ready(input);
    // A list opening under a still pointer: entered, not moved over.
    fireEvent.mouseEnter(options()[2]);
    expect(selected()).toBe(0);
    fireEvent.mouseMove(options()[2]);
    expect(selected()).toBe(2);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chips().map((c) => c.textContent)).toEqual(["tag:jazz"]);
  });

  it("names the whole text in the first row, which is what it searches for", async () => {
    const { input } = setup("", catalog);
    type(input, "sunset jazz");
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(texts()[0]).toBe("Search for “sunset jazz”");
  });

  it("starts again from the first row when the list comes back", async () => {
    const { input, last } = setup("", catalog);
    type(input, "sunset jazz");
    await waitFor(() => expect(options()).toHaveLength(3));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // Off to an earlier word, which closes the list, and back.
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    input.setSelectionRange(11, 11);
    fireEvent.select(input);
    expect(selected()).toBe(0);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chips()).toHaveLength(0);
    expect(last()).toBe("sunset jazz");
  });

  it("compares a word as tag names are, invisible characters and all", async () => {
    const { input } = setup("", catalog);
    await ready(input);
    type(input, "ja\u200bzz");
    expect(options()).toHaveLength(3);
  });

  it("searches for the word from its own row too", async () => {
    const { input, last } = setup("", catalog);
    await ready(input);
    fireEvent.click(options()[0]);
    expect(chips()).toHaveLength(0);
    expect(last()).toBe("jazz");
  });

  it("leaves Tab to move on over a word", async () => {
    const { input } = setup("", catalog);
    await ready(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // Not prevented: the browser moves focus on as usual.
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
    expect(chips()).toHaveLength(0);
  });

  it("leaves an input method alone while it composes", async () => {
    const { input, last } = setup("", catalog);
    await ready(input);
    // Picking and confirming a conversion.
    fireEvent.keyDown(input, { key: "ArrowDown", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(chips()).toHaveLength(0);
    // No list over text that is not final yet.
    fireEvent.compositionStart(input);
    expect(options()).toHaveLength(0);
    fireEvent.compositionEnd(input);
    expect(options()).toHaveLength(3);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(last()).toBe("jazz");
  });

  it("takes keys sent as 229 outside a composition, as Linux input methods send them", async () => {
    const { input } = setup("", catalog);
    await ready(input);
    fireEvent.keyDown(input, { key: "ArrowDown", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(chips()).toHaveLength(1);
  });

  it("scrolls the list, and only the list, to the row it highlights", async () => {
    // The list shows 288px; each row is 28px, the last one below the fold.
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (top: number, bottom: number) =>
          ({ top, bottom }) as DOMRect;
        if (this.getAttribute("data-slot") === "scroll-area-viewport")
          return box(0, 288);
        if (this.getAttribute("role") === "option")
          return /^tag:jazz/.test(this.textContent ?? "")
            ? box(300, 328)
            : box(0, 28);
        return box(0, 0);
      });
    const page = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    try {
      const { input } = setup("", catalog);
      await ready(input);
      // Up from the first row wraps to the last.
      fireEvent.keyDown(input, { key: "ArrowUp" });
      const viewport = document.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      expect(viewport?.scrollTop).toBe(40);
      expect(page).not.toHaveBeenCalled();
    } finally {
      rect.mockRestore();
      page.mockRestore();
    }
  });

  it("starts again from the first row when the list is fetched again in another order", async () => {
    const { input, qc } = setup("", catalog);
    await ready(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toBe(1);
    // The same word, its tags in another order (a count changed, say).
    qc.setQueryData(["tags_list_all", "library", "ws-test"], {
      tags: [...CATALOG, tag("jazz", 3), tag("jazz", 1, "audio_genre")],
      truncated: false,
    });
    await waitFor(() => expect(texts()[1]).toMatch(/^tag:jazz/));
    expect(selected()).toBe(0);
  });

  it("offers a namespace a word begins, then that namespace's values", async () => {
    const { input } = setup("", CATALOG);
    type(input, "tempo");
    await waitFor(() => expect(options()).toHaveLength(2));
    expect(options()[1].textContent).toMatch(/^tag:audio_tempo:/);
    // The first step: ArrowDown and Enter start the directive, not a chip.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("tag:audio_tempo:");
    expect(chips()).toHaveLength(0);
    // The second: the closed set's values, held or not.
    await waitFor(() =>
      expect(options().map((o) => o.textContent)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/slow/),
          expect.stringMatching(/moderate/),
          expect.stringMatching(/fast/),
        ]),
      ),
    );
  });

  it("offers a namespace by its full name once a _ is typed", async () => {
    const { input } = setup("", CATALOG);
    type(input, "audio_te");
    await waitFor(() => expect(options()).toHaveLength(2));
    expect(options()[1].textContent).toMatch(/^tag:audio_tempo:/);
  });

  it("does not offer every audio namespace for a part of their prefix", async () => {
    const { input } = setup("", [...CATALOG, tag("autumn", 2)]);
    type(input, "au");
    await waitFor(() => expect(options()).toHaveLength(2));
    expect(options()[1].textContent).toMatch(/^tag:autumn/);
  });

  it("keeps an Esc that cancels a conversion in the field", async () => {
    const { input } = setup("", catalog);
    await ready(input);
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    try {
      fireEvent.keyDown(input, { key: "Escape", isComposing: true });
      expect(outside).not.toHaveBeenCalled();
      expect(options()).toHaveLength(3);
    } finally {
      window.removeEventListener("keydown", outside);
    }
  });

  it("ranks a tag the word begins, compared as names are, first", async () => {
    const { input } = setup("", [
      tag("my beach", 50),
      tag("beach", 1),
      ...CATALOG,
    ]);
    type(input, "be\u200bach");
    await waitFor(() => expect(options().length).toBeGreaterThan(2));
    // Row 0 is the word's own search; the prefix hit outranks the busier one.
    expect(options()[1].textContent).toMatch(/^tag:beach/);
  });

  it("matches tag names, not the namespaces a word would hit", async () => {
    const { input } = setup("", catalog);
    await ready(input);
    // `au` is in `audio_genre`, not in any name.
    type(input, "au");
    expect(options()).toHaveLength(0);
  });

  it("offers nothing for one Latin letter, an accented one or alternatives, but does for one CJK character", async () => {
    const { input } = setup("", [...catalog, tag("猫", 4), tag("été", 2)]);
    await ready(input);
    for (const word of ["j", "é", "e\u0301", "rock|jazz"]) {
      type(input, word);
      expect(options()).toHaveLength(0);
    }
    type(input, "猫");
    expect(options()).toHaveLength(2);
  });

  it("offers nothing while the caret is back in an earlier word", async () => {
    const { input } = setup("", catalog);
    type(input, "sunset jazz");
    await waitFor(() => expect(options()).toHaveLength(3));
    // A pick replaces the last word, so none is offered for an earlier one.
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    expect(options()).toHaveLength(0);
    input.setSelectionRange(11, 11);
    fireEvent.select(input);
    expect(options()).toHaveLength(3);
  });
});
