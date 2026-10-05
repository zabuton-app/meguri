import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { onSearchLibrary } from "@/lib/ui-events";
import AutoTag from "@/routes/AutoTag";
import { resetAutoTagSession } from "@/routes/AutoTag/session";
import { resetViewState } from "@/routes/AutoTag/viewState";
import { renderWithProviders } from "@/test/renderWithProviders";
import {
  defaultAutoTagConfig,
  type AutoTagApplyResult,
  type AutoTagAssignment,
  type AutoTagConfig,
  type AutoTagLibrary,
} from "@shared/autoTag";

const mocks = vi.hoisted(() => ({
  autoTagGet: vi.fn<() => Promise<AutoTagConfig>>(),
  autoTagSet: vi.fn<(config: AutoTagConfig) => Promise<void>>(),
  autoTagFiles: vi.fn<() => Promise<AutoTagLibrary>>(),
  autoTagApply:
    vi.fn<(a: AutoTagAssignment[]) => Promise<AutoTagApplyResult>>(),
  autoTagUndo: vi.fn<(ids: string[]) => Promise<number>>(),
  autoTagReapply: vi.fn<() => Promise<{ files: number; added: number }>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    autoTagGet: () => mocks.autoTagGet(),
    autoTagSet: (config: AutoTagConfig) => mocks.autoTagSet(config),
    autoTagFiles: () => mocks.autoTagFiles(),
    autoTagApply: (a: AutoTagAssignment[]) => mocks.autoTagApply(a),
    autoTagUndo: (ids: string[]) => mocks.autoTagUndo(ids),
    autoTagReapply: () => mocks.autoTagReapply(),
  },
}));

const NAMES = [
  "ABCD-123 Morning yoga routine.mp4",
  "ABCD-124 Evening yoga stretch.mp4",
  "[Trip] Harbor walk.mp4",
  "[Trip] Harbor picnic.mp4",
  "IMG-2041.jpg",
];

function library(): AutoTagLibrary {
  return {
    files: NAMES.map((name, i) => ({
      workspaceId: "ws",
      id: i + 1,
      name,
      metaKey: `k${i}`,
      tags: i === 2 ? ["trip"] : [],
    })),
    total: NAMES.length,
    existingTags: ["trip"],
  };
}

async function renderScreen(tab?: string) {
  // At the screen's own route: a test that expects to land on the library
  // ("#/") would otherwise pass without anything having navigated.
  renderWithProviders(<AutoTag />, { route: "/auto-tag" });
  await screen.findByText("Pattern rules");
  if (tab) fireEvent.click(screen.getByRole("tab", { name: new RegExp(tab) }));
}

/** The config most recently written back to main. */
async function lastSaved(): Promise<AutoTagConfig> {
  await waitFor(() => expect(mocks.autoTagSet).toHaveBeenCalled(), {
    timeout: 2000,
  });
  return mocks.autoTagSet.mock.calls.at(-1)![0];
}

describe("AutoTag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetViewState();
    resetAutoTagSession();
    localStorage.clear();
    localStorage.setItem("meguri.lang", "en");
    mocks.autoTagGet.mockResolvedValue(defaultAutoTagConfig());
    mocks.autoTagFiles.mockResolvedValue(library());
    mocks.autoTagSet.mockResolvedValue();
    mocks.autoTagUndo.mockResolvedValue(1);
    mocks.autoTagApply.mockImplementation((assignments) =>
      Promise.resolve({
        files: assignments.reduce((n, a) => n + a.fileIds.length, 0),
        added: assignments.reduce(
          (n, a) => n + a.fileIds.length * a.tags.length,
          0,
        ),
        undoId: "undo-1",
      }),
    );
  });

  it("lists the rules with how many files each would tag and tests the selected one", async () => {
    await renderScreen();
    expect(
      screen.getByText("4 active rules · 0 keywords · 5 files", {
        exact: false,
      }),
    ).toBeTruthy();
    // The code-prefix rule tags the two ABCD files; IMG is excluded.
    expect(screen.getByText("2 of 5 would be tagged")).toBeTruthy();
    expect(screen.getAllByText("ABCD").length).toBeGreaterThan(0);
    expect(screen.getByText("Excluded")).toBeTruthy();
    // Nothing was edited, so nothing is written back.
    expect(mocks.autoTagSet).not.toHaveBeenCalled();
  });

  it("flags an invalid pattern and still saves the edit", async () => {
    await renderScreen();
    fireEvent.change(screen.getByDisplayValue("^([A-Z]{2,6})-\\d{2,5}"), {
      target: { value: "(" },
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("0 of 5 would be tagged")).toBeTruthy();
    expect((await lastSaved()).rules[0].pattern).toBe("(");
  });

  it("turns scanning on only when asked", async () => {
    await renderScreen();
    fireEvent.click(
      screen.getByRole("switch", { name: "Apply when scanning" }),
    );
    expect((await lastSaved()).applyOnScan).toBe(true);
  });

  it("registers a keyword beside the rules and shows the files it finds", async () => {
    await renderScreen();
    // "Tag, alias, alias" in one line, then Enter.
    const add = screen.getByLabelText(/Add a keyword/);
    fireEvent.change(add, { target: { value: "Yoga, ヨガ, stretch" } });
    fireEvent.keyDown(add, { key: "Enter" });

    // The new entry is selected: the pane switches from the rule to it.
    expect(screen.getByText("Creates a new tag")).toBeTruthy();
    expect(screen.getByText("Matching files")).toBeTruthy();
    expect(screen.getAllByText("2 files").length).toBeGreaterThan(0);
    expect((await lastSaved()).keywords).toMatchObject([
      { tag: "Yoga", aliases: ["ヨガ", "stretch"], mode: "word" },
    ]);

    // Selecting a rule brings its editor back.
    fireEvent.click(screen.getByRole("button", { name: /Square brackets/ }));
    expect(screen.getByText("2 of 5 would be tagged")).toBeTruthy();
    expect(screen.queryByText("Matching files")).toBeNull();
  });

  it("searches the library for a keyword's terms as alternatives", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...defaultAutoTagConfig(),
      keywords: [
        {
          id: "k1",
          tag: "Yoga",
          aliases: ["ヨガ", "morning stretch"],
          mode: "word",
        },
      ],
    });
    const asked: string[][] = [];
    const off = onSearchLibrary((tokens) => asked.push(tokens));
    await renderScreen();
    fireEvent.click(screen.getByRole("button", { name: /Yoga/ }));
    fireEvent.click(screen.getByRole("button", { name: "Search the library" }));
    off();

    // One token, any of the terms; quoted because one of them has a space.
    expect(asked).toEqual([['"Yoga|ヨガ|morning stretch"']]);
    // And the screen closes onto the library.
    expect(window.location.hash).toBe("#/");
  });

  it("stops filtering the dictionary once the filter box is gone", async () => {
    const entry = (i: number) => ({
      id: `k${i}`,
      tag: i === 0 ? "Yoga" : `Word${i}`,
      aliases: [],
      mode: "word" as const,
    });
    mocks.autoTagGet.mockResolvedValue({
      ...defaultAutoTagConfig(),
      keywords: Array.from({ length: 9 }, (_, i) => entry(i)),
    });
    await renderScreen();
    const filter = screen.getByLabelText("Filter keywords");
    fireEvent.change(filter, { target: { value: "nothing" } });
    expect(screen.getByText("No keyword matches the filter.")).toBeTruthy();

    fireEvent.change(filter, { target: { value: "yoga" } });
    fireEvent.click(screen.getByRole("button", { name: /Yoga/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // Eight left: the box is gone, and so is its filter.
    expect(screen.queryByLabelText("Filter keywords")).toBeNull();
    expect(screen.getByRole("button", { name: /Word1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Word8/ })).toBeTruthy();
  });

  it("does not take the Enter that confirms an IME conversion as submit", async () => {
    await renderScreen();
    const add = screen.getByLabelText(/Add a keyword/);
    fireEvent.change(add, { target: { value: "ヨガ" } });
    fireEvent.keyDown(add, { key: "Enter", isComposing: true });
    expect(screen.queryByText("Creates a new tag")).toBeNull();
    fireEvent.keyDown(add, { key: "Enter" });
    expect(screen.getByText("Creates a new tag")).toBeTruthy();
  });

  it("edits the selected keyword: aliases, match mode, removal", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...defaultAutoTagConfig(),
      keywords: [{ id: "k1", tag: "Yoga", aliases: [], mode: "word" }],
    });
    await renderScreen();
    fireEvent.click(screen.getByRole("button", { name: /Yoga/ }));

    const alias = screen.getByLabelText("+ Add alias");
    fireEvent.change(alias, { target: { value: "stretch" } });
    fireEvent.keyDown(alias, { key: "Enter" });
    fireEvent.click(screen.getByRole("radio", { name: "Contains" }));
    expect((await lastSaved()).keywords).toMatchObject([
      { tag: "Yoga", aliases: ["stretch"], mode: "contains" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect((await lastSaved()).keywords).toEqual([]));
    // With the entry gone the pane falls back to the first rule.
    expect(screen.getByText("2 of 5 would be tagged")).toBeTruthy();
  });

  it("applies a suggestion to the files that lack it, and takes it back", async () => {
    await renderScreen("Suggestions");
    const row = screen.getByRole("checkbox", { name: "Trip" }).closest("div")!;
    expect(within(row).getByText(/adds to existing tag/)).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    // File 3 already carries "trip"; only file 4 is sent, with the existing spelling.
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [4], tags: ["trip"] },
    ]);
    await screen.findByText("✓ Applied");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(mocks.autoTagUndo).toHaveBeenCalledWith(["undo-1"]),
    );
    await waitFor(() =>
      expect(within(row).getByRole("button", { name: "Apply" })).toBeTruthy(),
    );
  });

  it("keeps the way back when another tab is visited in between", async () => {
    await renderScreen("Suggestions");
    const apply = () =>
      within(
        screen.getByRole("checkbox", { name: "Trip" }).closest("div")!,
      ).getByRole("button", { name: "Apply" });
    fireEvent.click(apply());
    await screen.findByText("✓ Applied");

    fireEvent.click(screen.getByRole("tab", { name: "Conditions" }));
    fireEvent.click(screen.getByRole("tab", { name: /Suggestions/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(mocks.autoTagUndo).toHaveBeenCalledWith(["undo-1"]),
    );
  });

  it("does not call a suggestion applied when applying failed", async () => {
    mocks.autoTagApply.mockRejectedValue(new Error("disk full"));
    await renderScreen("Suggestions");
    const row = screen.getByRole("checkbox", { name: "Trip" }).closest("div")!;
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalled());
    // The list is loaded again to show what the files really carry.
    await waitFor(() => expect(mocks.autoTagFiles).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("✓ Applied")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leads with the dictionary for a word nothing produces yet", async () => {
    await renderScreen("Suggestions");
    // A frequent word: registering it is offered, ahead of a one-off apply.
    const word = screen
      .getByRole("checkbox", { name: "Harbor" })
      .closest("div")!;
    const buttons = within(word)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(buttons.indexOf("Add to dictionary")).toBeLessThan(
      buttons.indexOf("Apply"),
    );
    // A tag a rule already produces is managed by that rule: apply only.
    const ruled = screen
      .getByRole("checkbox", { name: "Trip" })
      .closest("div")!;
    expect(
      within(ruled).queryByRole("button", { name: "Add to dictionary" }),
    ).toBeNull();

    fireEvent.click(
      within(word).getByRole("button", { name: "Add to dictionary" }),
    );
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [3, 4], tags: ["Harbor"] },
    ]);
    expect((await lastSaved()).keywords).toMatchObject([{ tag: "Harbor" }]);
    await screen.findByText("✓ Applied and in dictionary");
  });

  it("searches the library for a candidate's spellings", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...defaultAutoTagConfig(),
      keywords: [{ id: "k1", tag: "Yoga", aliases: ["stretch"], mode: "word" }],
    });
    const asked: string[][] = [];
    const off = onSearchLibrary((tokens) => asked.push(tokens));
    await renderScreen("Suggestions");
    fireEvent.click(
      screen.getByRole("button", { name: "Search the library for “Yoga”" }),
    );
    off();

    // The tag and the spellings it was found under, as one token.
    expect(asked).toEqual([["Yoga|stretch"]]);
    expect(window.location.hash).toBe("#/");
  });

  it("shows a tag the dictionary already has as registered, not as a suggestion", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...defaultAutoTagConfig(),
      keywords: [{ id: "k1", tag: "Yoga", aliases: [], mode: "word" }],
    });
    await renderScreen("Suggestions");
    const row = screen.getByRole("checkbox", { name: "Yoga" }).closest("div")!;
    expect(within(row).getByText("In the dictionary")).toBeTruthy();
    // Not something to decide: it cannot be selected, registered or dismissed.
    expect(screen.getByRole("checkbox", { name: "Yoga" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(row).queryByRole("button", { name: "Ignore" })).toBeNull();
    expect(
      within(row).queryByRole("button", { name: "Add to dictionary" }),
    ).toBeNull();
    // Nor does it count as open: the badge shows the other candidates only
    // (ABCD, Trip and Harbor — the file tagged "trip" still lacks none).
    expect(
      within(screen.getByRole("tab", { name: /Suggestions/ })).getByText("3"),
    ).toBeTruthy();

    // The files that do not carry the tag yet can still get it from here.
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [1, 2], tags: ["Yoga"] },
    ]);
    await within(row).findByText("✓ Applied");
  });

  it("groups rules and the dictionary under one filter, named like their tab", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...defaultAutoTagConfig(),
      keywords: [{ id: "k1", tag: "Yoga", aliases: [], mode: "word" }],
    });
    await renderScreen("Suggestions");
    const filters = within(screen.getByRole("radiogroup", { name: "Filter" }));
    expect(
      filters.getAllByRole("radio").map((radio) => radio.textContent),
    ).toEqual(["All4", "Conditions3", "Frequent words1"]);

    // ABCD and Trip come from rules, Yoga from the dictionary; Harbor does not.
    fireEvent.click(filters.getByRole("radio", { name: /Conditions/ }));
    for (const name of ["ABCD", "Trip", "Yoga"]) {
      expect(screen.getByRole("checkbox", { name })).toBeTruthy();
    }
    expect(screen.queryByRole("checkbox", { name: "Harbor" })).toBeNull();
  });

  it("offers frequent words and remembers the ones dismissed", async () => {
    await renderScreen("Suggestions");
    // "Harbor" is in two names and no rule or keyword claims it.
    const row = screen
      .getByRole("checkbox", { name: "Harbor" })
      .closest("div")!;
    expect(within(row).getByText("Frequent word")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Ignore" }));
    expect((await lastSaved()).ignored).toEqual(["harbor"]);
    expect(within(row).getByText("Ignored")).toBeTruthy();
  });

  it("confirms a file's proposed tags and moves to the next one", async () => {
    await renderScreen("Review by file");
    expect(screen.getByText("1 of 5 files reviewed")).toBeTruthy();
    expect(screen.getByText("1 / 5")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirm and next" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [1], tags: ["ABCD"] },
    ]);
    await screen.findByText("2 / 5");
    expect(screen.getByText("2 of 5 files reviewed")).toBeTruthy();
  });

  it("moves on from a reviewed file even when nothing is left to review", async () => {
    await renderScreen("Review by file");
    // Confirm everything, so no file is left to review.
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm all 4 unreviewed files" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await screen.findByText("5 of 5 files reviewed");
    expect(screen.getByText("1 / 5")).toBeTruthy();

    // "Update and next" still goes to the next file, and the one after.
    fireEvent.click(screen.getByRole("button", { name: "Update and next" }));
    await screen.findByText("2 / 5");
    fireEvent.click(screen.getByRole("button", { name: "Update and next" }));
    await screen.findByText("3 / 5");
  });

  it("stays within the reviewed list when updating a reviewed file", async () => {
    await renderScreen("Review by file");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and next" }));
    await screen.findByText("2 / 5");
    // Reviewed: file 1 (just confirmed) and file 3 (already tagged).
    fireEvent.click(screen.getByRole("radio", { name: /Reviewed/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /ABCD-123 Morning yoga routine/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Update and next" }));
    // The next reviewed file, not file 2, which this list does not show.
    await screen.findByText("3 / 5");
    // At the end of the list it wraps round, still without leaving the list.
    fireEvent.click(screen.getByRole("button", { name: "Update and next" }));
    await screen.findByText("1 / 5");
  });

  it("creates nothing from a token when tagging the files failed", async () => {
    mocks.autoTagApply.mockRejectedValue(new Error("disk full"));
    await renderScreen("Review by file");
    fireEvent.click(screen.getByRole("button", { name: "yoga" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add to dictionary and apply" }),
    );
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalled());
    await waitFor(() => expect(mocks.autoTagFiles).toHaveBeenCalledTimes(2));
    // No entry, and no line claiming one was added.
    expect(mocks.autoTagSet).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not offer a dictionary entry the dictionary has no room for", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...defaultAutoTagConfig(),
      keywords: Array.from({ length: 500 }, (_, i) => ({
        id: `k${i}`,
        tag: `Word${i}`,
        aliases: [],
        mode: "word" as const,
      })),
    });
    await renderScreen("Review by file");
    fireEvent.click(screen.getByRole("button", { name: "yoga" }));
    expect(
      screen.getByRole("button", { name: "Add to dictionary and apply" }),
    ).toHaveProperty("disabled", true);
  });

  it("keeps the undo of a bulk apply through the next confirm and a tab switch", async () => {
    await renderScreen("Review by file");
    fireEvent.click(screen.getByRole("button", { name: "yoga" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add to dictionary and apply" }),
    );
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: /and next/ }));
    await screen.findByText("2 / 5");
    fireEvent.click(screen.getByRole("tab", { name: "Conditions" }));
    fireEvent.click(screen.getByRole("tab", { name: "Review by file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mocks.autoTagUndo).toHaveBeenCalled());
  });

  it("leaves a file unconfirmed when tagging it failed", async () => {
    mocks.autoTagApply.mockRejectedValue(new Error("disk full"));
    await renderScreen("Review by file");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and next" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalled());
    await waitFor(() => expect(mocks.autoTagFiles).toHaveBeenCalledTimes(2));
    expect(screen.getByText("1 of 5 files reviewed")).toBeTruthy();
  });

  it("closes the token panel on Escape, not the whole screen", async () => {
    await renderScreen("Review by file");
    fireEvent.click(screen.getByRole("button", { name: "yoga" }));
    expect(screen.getByText("Create tagging from “yoga”")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Create tagging from “yoga”")).toBeNull();
    // Still on the screen: the modal did not take the key as well.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(window.location.hash).toBe("#/auto-tag");
    expect(screen.getByText("1 / 5")).toBeTruthy();
  });

  it("moves with J and K even after a checkbox was used", async () => {
    await renderScreen("Review by file");
    const box = screen.getByRole("checkbox", { name: "Apply “ABCD”" });
    fireEvent.click(box);
    fireEvent.keyDown(box, { key: "j" });
    expect(screen.getByText("2 / 5")).toBeTruthy();
    fireEvent.keyDown(window, { key: "k" });
    expect(screen.getByText("1 / 5")).toBeTruthy();
  });

  it("makes a dictionary entry from a word and tags the files it matches", async () => {
    await renderScreen("Review by file");
    fireEvent.click(screen.getByRole("button", { name: "yoga" }));
    expect(screen.getByText("Create tagging from “yoga”")).toBeTruthy();
    // The option says how many files it would reach before anything is created.
    expect(screen.getByText("2 files match")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Add to dictionary and apply" }),
    );

    // Created, and applied to both files it matches — not only the open one.
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [1, 2], tags: ["yoga"] },
    ]);
    expect((await lastSaved()).keywords).toMatchObject([{ tag: "yoga" }]);
    expect((await screen.findByRole("status")).textContent).toContain(
      "Added “yoga” to the dictionary and tagged 2 files",
    );

    // The tags can be taken back; the entry stays.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(mocks.autoTagUndo).toHaveBeenCalledWith(["undo-1"]),
    );
    expect((await lastSaved()).keywords).toMatchObject([{ tag: "yoga" }]);
  });

  it("makes a rule from a code and tags each file with what the rule gives it", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...defaultAutoTagConfig(),
      // Without the built-in prefix rule, so the token offers to create it.
      rules: defaultAutoTagConfig().rules.filter((r) => r.id !== "prefix"),
    });
    await renderScreen("Review by file");
    fireEvent.click(screen.getByRole("button", { name: "ABCD-123" }));
    fireEvent.click(
      screen.getByRole("radio", { name: /Turn every code prefix into a tag/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add rule and apply" }));

    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    // The built-in rule again, excludes included: the camera file (IMG-2041)
    // is not tagged.
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [1, 2], tags: ["ABCD"] },
    ]);
    expect((await lastSaved()).rules.at(-1)).toMatchObject({
      kind: "prefix",
      template: "$1",
      exclude: "IMG, DSC, MVI",
    });
  });

  it("leaves rules out of the analysis after a visit that never finished", async () => {
    localStorage.setItem("meguri.autoTag.analyzing", "1");
    await renderScreen();
    expect(screen.getByRole("alert").textContent).toContain(
      "The last analysis did not finish",
    );
    // Nothing is run against the library, but the rules can still be edited.
    expect(screen.getByText("0 of 0 would be tagged")).toBeTruthy();
    expect(screen.getByDisplayValue("^([A-Z]{2,6})-\\d{2,5}")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Resume analysis" }));
    expect(screen.getByText("2 of 5 would be tagged")).toBeTruthy();
    expect(localStorage.getItem("meguri.autoTag.analyzing")).toBeNull();
  });

  it("sorts terms into tags, applies them and remembers the decision", async () => {
    await renderScreen("Sort terms");
    const term = screen.getByRole("button", { name: /Harbor/ });
    const row = term.closest("div")!;
    fireEvent.click(within(row).getByRole("button", { name: "Make tag" }));
    // Codes and bracket contents already come from the rules.
    expect(screen.getAllByText("from a rule").length).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Apply 3 tags" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    const sent = mocks.autoTagApply.mock.calls[0][0];
    expect(sent).toContainEqual({
      workspaceId: "ws",
      fileIds: [1, 2],
      tags: ["ABCD"],
    });
    expect(sent).toContainEqual({
      workspaceId: "ws",
      fileIds: [4],
      tags: ["Harbor", "trip"],
    });
    // Only the decision made here goes to the dictionary.
    expect((await lastSaved()).keywords).toMatchObject([{ tag: "Harbor" }]);
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  describe("coming back to the screen", () => {
    /** Open the screen, as the route does each time it is entered. */
    async function open() {
      const view = renderWithProviders(<AutoTag />, { route: "/auto-tag" });
      await screen.findByRole("tablist");
      await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
      return view;
    }

    it("shows the file being reviewed, and returns to it when reopened", async () => {
      const first = await open();
      fireEvent.click(screen.getByRole("tab", { name: "Review by file" }));
      fireEvent.keyDown(window, { key: "j" });
      expect(screen.getByText("2 / 5")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Show file" }));
      // The file's own detail route, in its own workspace.
      expect(window.location.hash).toBe("#/file/2?ws=ws");
      first.unmount();

      await open();
      // The same tab and the same file, not the first tab and the first file.
      expect(
        screen.getByRole("tab", { name: "Review by file" }),
      ).toHaveProperty("ariaSelected", "true");
      expect(screen.getByText("2 / 5")).toBeTruthy();
    });

    it("remembers what was selected and filtered on each tab", async () => {
      mocks.autoTagGet.mockResolvedValue({
        ...defaultAutoTagConfig(),
        keywords: [{ id: "k1", tag: "Yoga", aliases: [], mode: "word" }],
      });
      const first = await open();
      // Conditions: a keyword selected instead of the first rule.
      fireEvent.click(screen.getByRole("button", { name: /Yoga/ }));
      // Suggestions: a filter and an expanded row.
      fireEvent.click(screen.getByRole("tab", { name: /Suggestions/ }));
      fireEvent.click(screen.getByRole("radio", { name: /Frequent words/ }));
      // Terms: a search.
      fireEvent.click(screen.getByRole("tab", { name: "Sort terms" }));
      fireEvent.change(screen.getByLabelText("Search terms"), {
        target: { value: "harb" },
      });
      first.unmount();

      await open();
      expect(screen.getByLabelText("Search terms")).toHaveProperty(
        "value",
        "harb",
      );
      fireEvent.click(screen.getByRole("tab", { name: /Suggestions/ }));
      expect(
        screen.getByRole("radio", { name: /Frequent words/ }),
      ).toHaveProperty("ariaChecked", "true");
      fireEvent.click(screen.getByRole("tab", { name: "Conditions" }));
      expect(screen.getByText("Matching files")).toBeTruthy();
    });

    it("keeps the review's decisions while the file list is the same", async () => {
      const first = await open();
      fireEvent.click(screen.getByRole("tab", { name: "Review by file" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm and next" }));
      await screen.findByText("2 of 5 files reviewed");
      first.unmount();

      const second = await open();
      expect(screen.getByText("2 of 5 files reviewed")).toBeTruthy();
      second.unmount();

      // A different list: positions no longer mean the same files.
      const changed = library();
      changed.files = changed.files.slice(1);
      changed.total = changed.files.length;
      mocks.autoTagFiles.mockResolvedValue(changed);
      await open();
      expect(screen.getByText("1 of 4 files reviewed")).toBeTruthy();
    });
  });
});
