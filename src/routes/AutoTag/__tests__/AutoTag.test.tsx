import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { onSearchLibrary } from "@/lib/ui-events";
import AutoTag from "@/routes/AutoTag";
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
  filesBulkTag: vi.fn<
    (
      targets: { workspaceId: string; fileIds: number[] }[],
      add: string[],
      remove: string[],
    ) => Promise<{
      files: number;
      skipped: number;
      added: number;
      removed: number;
    }>
  >(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    autoTagGet: () => mocks.autoTagGet(),
    autoTagSet: (config: AutoTagConfig) => mocks.autoTagSet(config),
    autoTagFiles: () => mocks.autoTagFiles(),
    autoTagApply: (a: AutoTagAssignment[]) => mocks.autoTagApply(a),
    autoTagUndo: (ids: string[]) => mocks.autoTagUndo(ids),
    autoTagReapply: () => mocks.autoTagReapply(),
    filesBulkTag: (
      targets: { workspaceId: string; fileIds: number[] }[],
      add: string[],
      remove: string[],
    ) => mocks.filesBulkTag(targets, add, remove),
  },
}));

const NAMES = [
  "ABCD-123 Morning yoga routine.mp4",
  "ABCD-124 Evening yoga stretch.mp4",
  "[Trip] Harbor walk.mp4",
  "[Trip] Harbor picnic.mp4",
  "IMG-2041.jpg",
];

/**
 * The configuration most cases start from: the built-in rules switched on, as
 * a user who wants them has them (they ship switched off) — parentheses
 * aside, which is the set these cases were written against.
 */
function sampleConfig(): AutoTagConfig {
  const config = defaultAutoTagConfig();
  return {
    ...config,
    rules: config.rules.map((rule) => ({
      ...rule,
      enabled: rule.id !== "paren",
    })),
  };
}

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
    localStorage.clear();
    localStorage.setItem("meguri.lang", "en");
    mocks.autoTagGet.mockResolvedValue(sampleConfig());
    mocks.autoTagFiles.mockResolvedValue(library());
    mocks.autoTagSet.mockResolvedValue();
    mocks.autoTagUndo.mockResolvedValue(1);
    mocks.filesBulkTag.mockImplementation((targets) => {
      const files = targets.reduce((n, g) => n + g.fileIds.length, 0);
      return Promise.resolve({ files, skipped: 0, added: 0, removed: files });
    });
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

  it("ships the built-in rules switched off", async () => {
    mocks.autoTagGet.mockResolvedValue(defaultAutoTagConfig());
    await renderScreen();
    expect(
      screen.getByText("0 active rules · 0 keywords · 5 files", {
        exact: false,
      }),
    ).toBeTruthy();
    // As shipped already: there is nothing to reset.
    expect(screen.getByRole("button", { name: "Reset" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("resets the built-in rules to how they ship, keeping the rules added", async () => {
    const config = sampleConfig();
    mocks.autoTagGet.mockResolvedValue({
      ...config,
      rules: [
        // Edited, and one of the built-in rules deleted altogether.
        { ...config.rules[0], pattern: "^(X+)-\\d+" },
        ...config.rules.slice(2),
        { ...config.rules[0], id: "mine", name: "Mine", pattern: "^(Y+)" },
      ],
    });
    await renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    // It asks first; the answer is the dialog's own button.
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    const saved = await lastSaved();
    expect(saved.rules).toEqual([
      ...defaultAutoTagConfig().rules,
      expect.objectContaining({ id: "mine", pattern: "^(Y+)", enabled: true }),
    ]);
    expect(saved.rules.slice(0, 5).some((rule) => rule.enabled)).toBe(false);
  });

  it("grows to fill the window and back, and remembers which", async () => {
    const first = renderWithProviders(<AutoTag />, { route: "/auto-tag" });
    await screen.findByText("Pattern rules");
    const panel = () => screen.getByRole("dialog").firstElementChild!;
    // The centred panel to begin with: capped in width.
    expect(panel().className).toContain("max-w-[1160px]");
    fireEvent.click(screen.getByRole("button", { name: "Enlarge modal" }));
    expect(panel().className).not.toContain("max-w-[1160px]");
    expect(localStorage.getItem("meguri.autoTag.modalSize")).toContain("large");
    first.unmount();

    // Reopened, it is the size it was left at, and can be brought back.
    renderWithProviders(<AutoTag />, { route: "/auto-tag" });
    await screen.findByText("Pattern rules");
    expect(panel().className).not.toContain("max-w-[1160px]");
    fireEvent.click(screen.getByRole("button", { name: "Shrink modal" }));
    expect(panel().className).toContain("max-w-[1160px]");
  });

  it("lists a rule's excluded values, to add to, find in and remove from", async () => {
    await renderScreen();
    // The built-in rule's own list, a row each.
    expect(screen.getByText("3 values")).toBeTruthy();
    const remove = (value: string) =>
      screen.queryByRole("button", { name: `Remove “${value}”` });
    expect(remove("IMG")).toBeTruthy();
    expect(remove("MVI")).toBeTruthy();

    // Adding takes several at once and passes over what is listed already,
    // whatever its case.
    const field = screen.getByLabelText("Add a value, or type to find one");
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toHaveProperty("disabled", true);
    fireEvent.change(field, { target: { value: "img" } });
    expect(add).toHaveProperty("disabled", true);
    fireEvent.change(field, { target: { value: "ABCD, img" } });
    // A list pasted a value to a line is taken apart, not run together.
    fireEvent.paste(field, {
      clipboardData: { getData: () => "GOPR\r\nimg\n" },
    });
    expect(field).toHaveProperty("value", "ABCD, img, GOPR, img");
    fireEvent.click(add);
    expect((await lastSaved()).rules[0].exclude).toBe(
      "IMG\nDSC\nMVI\nABCD\nGOPR",
    );
    expect(screen.getByText("5 values")).toBeTruthy();
    expect(field).toHaveProperty("value", "");
    // It counts at once: ABCD is excluded now.
    expect(screen.getByText("0 of 5 would be tagged")).toBeTruthy();

    // The same field finds a value among the many.
    fireEvent.change(field, { target: { value: "gop" } });
    expect(remove("GOPR")).toBeTruthy();
    expect(remove("IMG")).toBeNull();
    fireEvent.click(remove("GOPR")!);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(remove("ABCD")!);
    await waitFor(async () =>
      expect((await lastSaved()).rules[0].exclude).toBe("IMG\nDSC\nMVI"),
    );
    expect(screen.getByText("2 of 5 would be tagged")).toBeTruthy();

    // Enter adds as the button does.
    fireEvent.change(field, { target: { value: "PXL" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(remove("PXL")).toBeTruthy();
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
      ...sampleConfig(),
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
      ...sampleConfig(),
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
      ...sampleConfig(),
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

  it("deletes keywords with the Delete key, one press each", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...sampleConfig(),
      keywords: [
        { id: "k1", tag: "Yoga", aliases: [], mode: "word" },
        { id: "k2", tag: "Harbor", aliases: [], mode: "word" },
        { id: "k3", tag: "Trip", aliases: [], mode: "word" },
      ],
    });
    await renderScreen();
    const row = (name: RegExp) => screen.getByRole("button", { name });
    fireEvent.click(row(/^Harbor/));
    fireEvent.keyDown(row(/^Harbor/), { key: "Delete" });
    await waitFor(async () =>
      expect((await lastSaved()).keywords.map((k) => k.tag)).toEqual([
        "Yoga",
        "Trip",
      ]),
    );
    // The entry that took its place is selected and has the focus, so the
    // next press goes on from there — and at the end, back to the one before.
    await waitFor(() => expect(document.activeElement).toBe(row(/^Trip/)));
    expect(row(/^Trip/).getAttribute("aria-current")).toBe("true");
    fireEvent.keyDown(row(/^Trip/), { key: "Delete" });
    await waitFor(() => expect(document.activeElement).toBe(row(/^Yoga/)));
    await waitFor(async () =>
      expect((await lastSaved()).keywords.map((k) => k.tag)).toEqual(["Yoga"]),
    );

    // In a field the key belongs to the text being edited.
    const alias = screen.getByLabelText("+ Add alias");
    fireEvent.keyDown(alias, { key: "Delete" });
    expect(row(/^Yoga/)).toBeTruthy();
  });

  it("applies a suggestion to the files that lack it, and takes the tag off again", async () => {
    await renderScreen("Keywords");
    const row = screen.getByRole("checkbox", { name: "Trip" }).closest("div")!;
    expect(within(row).getByText(/adds to existing tag/)).toBeTruthy();
    // One of its two files carries the tag already, from before.
    expect(
      within(row).getByRole("button", { name: "Remove from 1 files" }),
    ).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    // File 3 already carries "trip"; only file 4 is sent, with the existing spelling.
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [4], tags: ["trip"] },
    ]);
    // Nothing left to apply; what there is to do is take it off both.
    const remove = await within(row).findByRole("button", {
      name: "Remove from 2 files",
    });
    expect(within(row).queryByRole("button", { name: "Apply" })).toBeNull();

    // It goes by what the files carry, not by what was applied here: the file
    // tagged before the screen was opened loses the tag too, so it asks.
    fireEvent.click(remove);
    expect(mocks.filesBulkTag).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mocks.filesBulkTag).toHaveBeenCalledWith(
        [{ workspaceId: "ws", fileIds: [3, 4] }],
        [],
        ["trip"],
      ),
    );
    await within(row).findByRole("button", { name: "Apply" });
    expect(
      within(row).queryByRole("button", { name: /Remove from/ }),
    ).toBeNull();
    expect(screen.getByText("Removed “Trip” from 2 files.")).toBeTruthy();
  });

  it("takes the tag off a file's copies with it, in its workspace only", async () => {
    // File 5 is a copy of file 3 under a name the candidate does not match,
    // and so is a file of another workspace: same content, its own database.
    const copies = library();
    copies.files[4] = {
      ...copies.files[4],
      metaKey: copies.files[2].metaKey,
      tags: ["trip"],
    };
    copies.files.push({
      workspaceId: "other",
      id: 9,
      name: "backup_001.mp4",
      metaKey: copies.files[2].metaKey,
      tags: ["trip"],
    });
    copies.total = copies.files.length;
    mocks.autoTagFiles.mockResolvedValue(copies);
    await renderScreen("Keywords");
    const row = screen.getByRole("checkbox", { name: "Trip" }).closest("div")!;
    fireEvent.click(
      within(row).getByRole("button", { name: "Remove from 1 files" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    // Only the file the candidate names is sent; main detaches by content.
    await waitFor(() =>
      expect(mocks.filesBulkTag).toHaveBeenCalledWith(
        [{ workspaceId: "ws", fileIds: [3] }],
        [],
        ["trip"],
      ),
    );
    await within(row).findByRole("button", { name: "Apply" });

    // With the tag gone, applying again reaches both of the candidate's files.
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [3, 4], tags: ["trip"] },
    ]);
  });

  it("shows what the files carry when taking a tag off failed", async () => {
    mocks.filesBulkTag.mockRejectedValue(new Error("locked"));
    await renderScreen("Keywords");
    const row = () =>
      screen.getByRole("checkbox", { name: "Trip" }).closest("div")!;
    fireEvent.click(
      within(row()).getByRole("button", { name: "Remove from 1 files" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    // The list is read again rather than guessed at, and nothing is claimed.
    await waitFor(() => expect(mocks.autoTagFiles).toHaveBeenCalledTimes(2));
    await within(row()).findByRole("button", { name: "Remove from 1 files" });
    expect(screen.queryByText(/^Removed/)).toBeNull();
  });

  it("reads the files again on request", async () => {
    await renderScreen("Keywords");
    const tagged = library();
    tagged.files[3].tags = ["trip"];
    mocks.autoTagFiles.mockResolvedValue(tagged);
    fireEvent.click(
      screen.getByRole("button", { name: "Re-analyze all files" }),
    );
    const row = () =>
      screen.getByRole("checkbox", { name: "Trip" }).closest("div")!;
    await within(row()).findByRole("button", { name: "Remove from 2 files" });
  });

  it("removes nothing when the question is declined", async () => {
    await renderScreen("Keywords");
    const row = screen.getByRole("checkbox", { name: "Trip" }).closest("div")!;
    fireEvent.click(
      within(row).getByRole("button", { name: "Remove from 1 files" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull(),
    );
    expect(mocks.filesBulkTag).not.toHaveBeenCalled();
  });

  it("does not call a suggestion applied when applying failed", async () => {
    mocks.autoTagApply.mockRejectedValue(new Error("disk full"));
    await renderScreen("Keywords");
    const row = screen.getByRole("checkbox", { name: "Trip" }).closest("div")!;
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalled());
    // The list is loaded again to show what the files really carry.
    await waitFor(() => expect(mocks.autoTagFiles).toHaveBeenCalledTimes(2));
    // Still the one file that carried the tag before, not two.
    expect(
      screen.getByRole("button", { name: "Remove from 1 files" }),
    ).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leads with the dictionary for a word nothing produces yet", async () => {
    await renderScreen("Keywords");
    // A frequent word: registering it is offered, ahead of a one-off apply.
    const word = screen
      .getByRole("checkbox", { name: "Harbor" })
      .closest("div")!;
    const buttons = within(word)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(buttons.indexOf("Add to keywords")).toBeLessThan(
      buttons.indexOf("Apply"),
    );
    // A tag a rule already produces is managed by that rule: apply only.
    const ruled = screen
      .getByRole("checkbox", { name: "Trip" })
      .closest("div")!;
    expect(
      within(ruled).queryByRole("button", { name: "Add to keywords" }),
    ).toBeNull();

    fireEvent.click(
      within(word).getByRole("button", { name: "Add to keywords" }),
    );
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [3, 4], tags: ["Harbor"] },
    ]);
    expect((await lastSaved()).keywords).toMatchObject([{ tag: "Harbor" }]);
    // Both are now so, and each is said: on the files, and in the keywords.
    await within(word).findByRole("button", { name: "Remove from 2 files" });
    expect(within(word).getByText("In keywords")).toBeTruthy();
    expect(
      within(word).queryByRole("button", { name: "Add to keywords" }),
    ).toBeNull();
  });

  it("offers the keywords for a word they do not hold, tagged or not", async () => {
    // Every file with "Harbor" in its name carries the tag already — applied
    // once, earlier — but the keywords have no entry for it.
    const tagged = library();
    tagged.files[2].tags = ["trip", "Harbor"];
    tagged.files[3].tags = ["Harbor"];
    tagged.existingTags = ["trip", "Harbor"];
    mocks.autoTagFiles.mockResolvedValue(tagged);
    await renderScreen("Keywords");
    const row = screen
      .getByRole("checkbox", { name: "Harbor" })
      .closest("div")!;
    // On the files is what the files say; it is no claim about the keywords.
    expect(
      within(row).getByRole("button", { name: "Remove from 2 files" }),
    ).toBeTruthy();
    expect(within(row).queryByText("In keywords")).toBeNull();
    expect(within(row).queryByRole("button", { name: "Apply" })).toBeNull();

    // Adding the entry tags nothing: there is nothing left to tag.
    fireEvent.click(
      within(row).getByRole("button", { name: "Add to keywords" }),
    );
    expect((await lastSaved()).keywords).toMatchObject([{ tag: "Harbor" }]);
    expect(mocks.autoTagApply).not.toHaveBeenCalled();
    // The notice reports what happened: an entry added, no file tagged.
    expect(screen.getByText("Added 1 to keywords.")).toBeTruthy();
    expect(screen.queryByText(/^Applied “/)).toBeNull();
    await within(row).findByText("In keywords");
    expect(
      within(row).queryByRole("button", { name: "Add to keywords" }),
    ).toBeNull();
  });

  it("stops saying a word is in the keywords once its entry is deleted", async () => {
    await renderScreen("Keywords");
    const harbor = () =>
      screen.getByRole("checkbox", { name: "Harbor" }).closest("div")!;
    fireEvent.click(
      within(harbor()).getByRole("button", { name: "Add to keywords" }),
    );
    await within(harbor()).findByText("In keywords");

    // The entry is deleted where entries are managed…
    fireEvent.click(screen.getByRole("tab", { name: "Conditions" }));
    fireEvent.click(screen.getByRole("button", { name: /Harbor/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect((await lastSaved()).keywords).toEqual([]));

    // …and the suggestion follows: still on the files, no longer a keyword.
    fireEvent.click(screen.getByRole("tab", { name: /Keywords/ }));
    expect(within(harbor()).queryByText("In keywords")).toBeNull();
    expect(
      within(harbor()).getByRole("button", { name: "Remove from 2 files" }),
    ).toBeTruthy();
    expect(
      within(harbor()).getByRole("button", { name: "Add to keywords" }),
    ).toBeTruthy();
  });

  it("searches the library for a candidate's spellings", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...sampleConfig(),
      keywords: [{ id: "k1", tag: "Yoga", aliases: ["stretch"], mode: "word" }],
    });
    const asked: string[][] = [];
    const off = onSearchLibrary((tokens) => asked.push(tokens));
    await renderScreen("Keywords");
    const row = screen.getByRole("checkbox", { name: "Yoga" }).closest("div")!;
    fireEvent.click(within(row).getByRole("button", { name: "View Files" }));
    off();

    // The tag and the spellings it was found under, as one token.
    expect(asked).toEqual([["Yoga|stretch"]]);
    expect(window.location.hash).toBe("#/");
  });

  it("shows a tag the dictionary already has as registered, not as a suggestion", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...sampleConfig(),
      keywords: [{ id: "k1", tag: "Yoga", aliases: [], mode: "word" }],
    });
    await renderScreen("Keywords");
    const row = screen.getByRole("checkbox", { name: "Yoga" }).closest("div")!;
    expect(within(row).getByText("In keywords")).toBeTruthy();
    // Not something to decide: it cannot be selected, registered or dismissed.
    expect(screen.getByRole("checkbox", { name: "Yoga" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(row).queryByRole("button", { name: "Ignore" })).toBeNull();
    expect(
      within(row).queryByRole("button", { name: "Add to keywords" }),
    ).toBeNull();
    // Nor does it count as open: the badge shows the other candidates only
    // (ABCD, Trip and Harbor — the file tagged "trip" still lacks none).
    expect(
      within(screen.getByRole("tab", { name: /Keywords/ })).getByText("3"),
    ).toBeTruthy();

    // The files that do not carry the tag yet can still get it from here.
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocks.autoTagApply).toHaveBeenCalledTimes(1));
    expect(mocks.autoTagApply.mock.calls[0][0]).toEqual([
      { workspaceId: "ws", fileIds: [1, 2], tags: ["Yoga"] },
    ]);
    await within(row).findByRole("button", { name: "Remove from 2 files" });
  });

  it("groups rules and the dictionary under one filter, named like their tab", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...sampleConfig(),
      keywords: [{ id: "k1", tag: "Yoga", aliases: [], mode: "word" }],
    });
    await renderScreen("Keywords");
    const filters = within(screen.getByRole("radiogroup", { name: "Filter" }));
    expect(
      filters.getAllByRole("radio").map((radio) => radio.textContent),
    ).toEqual(["All4", "Conditions3", "Frequent words1", "Ignored0"]);

    // ABCD and Trip come from rules, Yoga from the dictionary; Harbor does not.
    fireEvent.click(filters.getByRole("radio", { name: /Conditions/ }));
    for (const name of ["ABCD", "Trip", "Yoga"]) {
      expect(screen.getByRole("checkbox", { name })).toBeTruthy();
    }
    expect(screen.queryByRole("checkbox", { name: "Harbor" })).toBeNull();
  });

  it("offers frequent words and remembers the ones dismissed", async () => {
    await renderScreen("Keywords");
    // "Harbor" is in two names and no rule or keyword claims it.
    const row = screen
      .getByRole("checkbox", { name: "Harbor" })
      .closest("div")!;
    expect(within(row).getByText("Frequent word")).toBeTruthy();
    const open = screen.getByText(/candidates \(\d+ open\)/).textContent;
    fireEvent.click(within(row).getByRole("button", { name: "Ignore" }));
    expect((await lastSaved()).ignored).toEqual(["harbor"]);
    // Dismissed is out of the way: gone from the list and from its counts.
    expect(screen.queryByRole("checkbox", { name: "Harbor" })).toBeNull();
    expect(screen.getByText(/candidates \(\d+ open\)/).textContent).not.toBe(
      open,
    );

    // It is kept where the dismissed ones are, and can be brought back.
    fireEvent.click(screen.getByRole("radio", { name: /Ignored\s*1/ }));
    const ignored = screen
      .getByRole("checkbox", { name: "Harbor" })
      .closest("div")!;
    // Its row's and the heading's.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(within(ignored).getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await lastSaved()).ignored).toEqual([]));
    expect(screen.queryByRole("checkbox", { name: "Harbor" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /^All/ }));
    expect(screen.getByRole("checkbox", { name: "Harbor" })).toBeTruthy();
  });

  it("narrows to the candidates with files still to tag", async () => {
    // "Harbor" is on both of its files already — applied once, not a keyword
    // — while the other candidates have files that lack their tag.
    const tagged = library();
    tagged.files[2].tags = ["trip", "Harbor"];
    tagged.files[3].tags = ["Harbor"];
    tagged.existingTags = ["trip", "Harbor"];
    mocks.autoTagFiles.mockResolvedValue(tagged);
    await renderScreen("Keywords");
    // Listed all the same: the keywords do not hold it.
    expect(screen.getByRole("checkbox", { name: "Harbor" })).toBeTruthy();

    const applied = within(
      screen.getByRole("radiogroup", { name: "Tags on files" }),
    );
    fireEvent.click(applied.getByRole("radio", { name: "Not applied" }));
    expect(screen.queryByRole("checkbox", { name: "Harbor" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "ABCD" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Trip" })).toBeTruthy();

    // It holds across the filters, and comes off again.
    fireEvent.click(screen.getByRole("radio", { name: /Frequent words/ }));
    expect(screen.queryByRole("checkbox", { name: "Harbor" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "yoga" })).toBeTruthy();
    fireEvent.click(applied.getByRole("radio", { name: "Any" }));
    expect(screen.getByRole("checkbox", { name: "Harbor" })).toBeTruthy();
  });

  it("narrows to the candidates on files, and takes several off at once", async () => {
    // "Harbor" is on both of its files and "trip" on one of Trip's two; ABCD
    // and yoga are on none.
    const tagged = library();
    tagged.files[2].tags = ["trip", "Harbor"];
    tagged.files[3].tags = ["Harbor"];
    tagged.existingTags = ["trip", "Harbor"];
    mocks.autoTagFiles.mockResolvedValue(tagged);
    await renderScreen("Keywords");
    const applied = within(
      screen.getByRole("radiogroup", { name: "Tags on files" }),
    );
    fireEvent.click(applied.getByRole("radio", { name: "Applied" }));
    expect(screen.getByRole("checkbox", { name: "Harbor" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Trip" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "ABCD" })).toBeNull();
    // One of the three at a time.
    expect(applied.getByRole("radio", { name: "Not applied" })).toHaveProperty(
      "ariaChecked",
      "false",
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    const bar = screen.getByText(/2 selected/).closest("div")!;
    fireEvent.click(
      within(bar).getByRole("button", { name: "Remove from 2 files" }),
    );
    // Asked about once for all of them, with what it comes to.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove 2 tags?")).toBeTruthy();
    expect(mocks.filesBulkTag).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocks.filesBulkTag).toHaveBeenCalledTimes(2));
    expect(mocks.filesBulkTag).toHaveBeenCalledWith(
      [{ workspaceId: "ws", fileIds: [3, 4] }],
      [],
      ["Harbor"],
    );
    expect(mocks.filesBulkTag).toHaveBeenCalledWith(
      [{ workspaceId: "ws", fileIds: [3] }],
      [],
      ["trip"],
    );
    await screen.findByText("Removed 2 tags from 3 files.");
    // Nothing is on files any more: the narrowed list is empty.
    expect(screen.queryByRole("checkbox", { name: "Harbor" })).toBeNull();
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it("brings several dismissed candidates back at once", async () => {
    mocks.autoTagGet.mockResolvedValue({
      ...sampleConfig(),
      ignored: ["harbor", "trip", "abcd"],
    });
    await renderScreen("Keywords");
    fireEvent.click(screen.getByRole("radio", { name: /Ignored\s*3/ }));
    // Among the dismissed, a row's checkbox picks it to be brought back.
    fireEvent.click(screen.getByRole("checkbox", { name: "Harbor" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Trip" }));
    const bar = screen.getByText("2 selected").closest("div")!;
    // Nothing here applies or ignores: there is only the way back.
    expect(within(bar).queryByRole("button", { name: /Apply/ })).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "Undo" }));
    await waitFor(async () =>
      expect((await lastSaved()).ignored).toEqual(["abcd"]),
    );
    expect(screen.queryByRole("checkbox", { name: "Harbor" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "ABCD" })).toBeTruthy();
    expect(screen.queryByText(/selected/)).toBeNull();

    // The heading's checkbox takes all that are left.
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(
      within(screen.getByText("1 selected").closest("div")!).getByRole(
        "button",
        { name: "Undo" },
      ),
    );
    await waitFor(async () => expect((await lastSaved()).ignored).toEqual([]));
  });

  it("pages through a list too long to draw at once, and starts over when it is filtered", async () => {
    // 250 words, each in two files: more candidates than one page holds.
    const letter = (n: number) => String.fromCharCode(97 + (n % 26));
    const wordAt = (n: number) =>
      `kite${letter(Math.floor(n / 26))}${letter(n)}`;
    const big = library();
    big.files = Array.from({ length: 500 }, (_, i) => ({
      workspaceId: "ws",
      id: i + 1,
      name: `${wordAt(Math.floor(i / 2))} clip.mp4`,
      metaKey: `k${i}`,
      tags: [],
    }));
    big.total = big.files.length;
    mocks.autoTagFiles.mockResolvedValue(big);
    await renderScreen("Keywords");
    const pager = await screen.findByRole("navigation", { name: "Pages" });
    const total = within(pager).getByText(/^1–200 of \d+$/).textContent;
    const count = Number(total?.split(" of ")[1]);
    expect(count).toBeGreaterThan(200);
    // A page of rows, plus the heading's.
    expect(screen.getAllByRole("checkbox").length).toBeLessThanOrEqual(201);
    expect(
      within(pager).getByRole("button", { name: "Previous" }),
    ).toHaveProperty("disabled", true);

    fireEvent.click(within(pager).getByRole("button", { name: "Next" }));
    expect(
      within(pager).getByText(`201–${Math.min(400, count)} of ${count}`),
    ).toBeTruthy();
    // The last page is the end of it.
    fireEvent.click(within(pager).getByRole("button", { name: "Next" }));
    expect(within(pager).getByRole("button", { name: "Next" })).toHaveProperty(
      "disabled",
      true,
    );

    // Another filter is another list: back to its first page.
    fireEvent.click(screen.getByRole("radio", { name: /Frequent words/ }));
    expect(screen.getByText(/^1–200 of \d+$/)).toBeTruthy();
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

  describe("coming back to the screen", () => {
    /** Open the screen, as the route does each time it is entered. */
    async function open() {
      const view = renderWithProviders(<AutoTag />, { route: "/auto-tag" });
      await screen.findByRole("tablist");
      await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
      return view;
    }

    it("remembers what was selected and filtered on each tab", async () => {
      mocks.autoTagGet.mockResolvedValue({
        ...sampleConfig(),
        keywords: [{ id: "k1", tag: "Yoga", aliases: [], mode: "word" }],
      });
      const first = await open();
      // Conditions: a keyword selected instead of the first rule.
      fireEvent.click(screen.getByRole("button", { name: /Yoga/ }));
      // Suggested keywords: a filter.
      fireEvent.click(screen.getByRole("tab", { name: /Keywords/ }));
      fireEvent.click(screen.getByRole("radio", { name: /Frequent words/ }));
      first.unmount();

      await open();
      // The tab it was left on, with its filter.
      expect(screen.getByRole("tab", { name: /Keywords/ })).toHaveProperty(
        "ariaSelected",
        "true",
      );
      expect(
        screen.getByRole("radio", { name: /Frequent words/ }),
      ).toHaveProperty("ariaChecked", "true");
      fireEvent.click(screen.getByRole("tab", { name: "Conditions" }));
      expect(screen.getByText("Matching files")).toBeTruthy();
    });
  });
});
