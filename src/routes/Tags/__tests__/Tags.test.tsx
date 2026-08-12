import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { MAX_TAG_NAME } from "@shared/tags";
import Tags from "@/routes/Tags";
import { defaultAppStatus, defaultWorkspacesList } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import type {
  AppStatus,
  TagList,
  TagRef,
  TagSummary,
  WorkspacesList,
} from "@/ipc/types";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn<() => Promise<AppStatus>>(),
  workspacesList: vi.fn<() => Promise<WorkspacesList>>(),
  tagsListAll: vi.fn<() => Promise<TagList>>(),
  tagRename:
    vi.fn<
      (
        from: TagRef,
        to: string,
      ) => Promise<{ merged: boolean; affectedFiles: number }>
    >(),
  tagMerge:
    vi.fn<
      (from: TagRef[], into: TagRef) => Promise<{ affectedFiles: number }>
    >(),
  tagDelete:
    vi.fn<
      (
        tags: TagRef[],
      ) => Promise<{ removedTags: number; affectedFiles: number }>
    >(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    tagsListAll: () => mocks.tagsListAll(),
    tagRename: (from: TagRef, to: string) => mocks.tagRename(from, to),
    tagMerge: (from: TagRef[], into: TagRef) => mocks.tagMerge(from, into),
    tagDelete: (tags: TagRef[]) => mocks.tagDelete(tags),
  },
}));

function tag(
  namespace: string,
  name: string,
  fileCount: number,
  source = namespace ? "auto-meta" : "manual",
): TagSummary {
  return {
    namespace,
    name,
    qualified: namespace ? `${namespace}:${name}` : name,
    fileCount,
    bySource: [{ source, count: fileCount }],
    pipelineOwned: namespace !== "",
    workspaceIds: ["ws"],
  };
}

const CATALOG: TagList = {
  tags: [
    tag("", "beach", 12),
    tag("", "holiday", 5),
    tag("", "sunset", 3),
    tag("res", "4k", 40),
  ],
  truncated: false,
};

function TagsRoute() {
  return (
    <Routes>
      <Route path="/" element={<div data-testid="home" />} />
      <Route path="/tags" element={<Tags />} />
    </Routes>
  );
}

function render() {
  return renderWithProviders(<TagsRoute />, { route: "/tags" });
}

describe("Tags screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.tagsListAll.mockResolvedValue(CATALOG);
    mocks.tagRename.mockResolvedValue({ merged: false, affectedFiles: 1 });
    mocks.tagMerge.mockResolvedValue({ affectedFiles: 1 });
    mocks.tagDelete.mockResolvedValue({ removedTags: 1, affectedFiles: 1 });
  });

  it("groups manual tags before generated ones and shows counts", async () => {
    render();
    expect(await screen.findByText("Manual tags")).toBeTruthy();
    expect(screen.getByText("Resolution")).toBeTruthy();
    expect(screen.getByText("12 files")).toBeTruthy();
    // 12 + 5 + 3 + 40 assignments, not files: a file can carry several tags.
    expect(screen.getByText("4 tags / 60 assignments")).toBeTruthy();
  });

  it("offers no edit affordance on a pipeline-owned tag", async () => {
    render();
    await screen.findByText("Manual tags");
    // One rename/delete pair per manual tag, none for the generated one.
    expect(screen.getAllByLabelText("Rename")).toHaveLength(3);
    expect(screen.getAllByLabelText("Delete")).toHaveLength(3);
    expect(screen.getByText("Read-only", { exact: false })).toBeTruthy();
    // Selection is limited to editable rows too.
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("narrows the list with the filter box and reports no match", async () => {
    render();
    // Wait for the catalog: typing while it is still loading would only prove
    // that the empty state renders.
    await screen.findByText("Manual tags");
    const box = screen.getByLabelText("Filter tags");
    fireEvent.change(box, { target: { value: "holi" } });
    await waitFor(() => expect(screen.queryByText("beach")).toBeNull());
    expect(screen.getByText("holiday")).toBeTruthy();

    fireEvent.change(box, { target: { value: "zzz" } });
    expect(await screen.findByText("No matching tags.")).toBeTruthy();
  });

  it("persists the sort choice", async () => {
    render();
    fireEvent.click(await screen.findByText("By name"));
    await waitFor(() =>
      expect(localStorage.getItem("meguri.tags.sort")).toBe("name"),
    );
  });

  it("toggles the modal size and persists it", async () => {
    render();
    fireEvent.click(await screen.findByLabelText("Enlarge modal"));
    expect(screen.getByLabelText("Shrink modal")).toBeTruthy();
    expect(localStorage.getItem("meguri.tags.modalSize")).toBe("large");
  });

  it("renames a tag to a name that is free", async () => {
    render();
    await screen.findByText("Manual tags");
    fireEvent.click(screen.getAllByLabelText("Rename")[0]);

    const input = await screen.findByLabelText("New tag name");
    fireEvent.change(input, { target: { value: "shore" } });
    fireEvent.click(screen.getByText("Rename", { selector: "button" }));

    await waitFor(() =>
      expect(mocks.tagRename).toHaveBeenCalledWith(
        { namespace: "", name: "beach" },
        "shore",
      ),
    );
    expect(mocks.tagMerge).not.toHaveBeenCalled();
  });

  it("escalates a colliding rename to a merge after confirmation", async () => {
    render();
    await screen.findByText("Manual tags");
    fireEvent.click(screen.getAllByLabelText("Rename")[0]);

    const input = await screen.findByLabelText("New tag name");
    fireEvent.change(input, { target: { value: "holiday" } });
    // The submit button switches to the merge wording once a collision is detected.
    fireEvent.click(screen.getByText("Merge", { selector: "button" }));
    fireEvent.click(await screen.findByText("Merge", { selector: "button" }));

    await waitFor(() =>
      expect(mocks.tagMerge).toHaveBeenCalledWith(
        [{ namespace: "", name: "beach" }],
        { namespace: "", name: "holiday" },
      ),
    );
    expect(mocks.tagRename).not.toHaveBeenCalled();
  });

  it("refuses an over-long name in the form instead of at the IPC layer", async () => {
    render();
    await screen.findByText("Manual tags");
    fireEvent.click(screen.getAllByLabelText("Rename")[0]);

    const input =
      await screen.findByLabelText<HTMLInputElement>("New tag name");
    // The field caps typing; the guard behind it is what a value arriving any
    // other way hits, since the IPC rejection is a raw Zod message in a toast.
    expect(input.maxLength).toBe(MAX_TAG_NAME);
    fireEvent.change(input, {
      target: { value: "x".repeat(MAX_TAG_NAME + 1) },
    });

    expect(await screen.findByText(/at most 64 characters/)).toBeTruthy();
    expect(
      screen
        .getByText("Rename", { selector: "button" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(mocks.tagRename).not.toHaveBeenCalled();
  });

  it("rejects a rename that would impersonate a generated namespace", async () => {
    render();
    await screen.findByText("Manual tags");
    fireEvent.click(screen.getAllByLabelText("Rename")[0]);

    const input = await screen.findByLabelText("New tag name");
    fireEvent.change(input, { target: { value: "res:8k" } });

    expect(await screen.findByText(/^"res:" is reserved/)).toBeTruthy();
    expect(
      screen
        .getByText("Rename", { selector: "button" })
        .hasAttribute("disabled"),
    ).toBe(true);

    // The search directive is reserved too, and the message has to name it: the
    // display-only name parser reads "tag:foo" as a plain name, so asking it
    // for the prefix used to print a bare colon.
    fireEvent.change(input, { target: { value: "tag:foo" } });
    expect(await screen.findByText(/^"tag:" is reserved/)).toBeTruthy();
  });

  it("deletes a tag after confirmation", async () => {
    render();
    await screen.findByText("Manual tags");
    fireEvent.click(screen.getAllByLabelText("Delete")[0]);
    // ConfirmDialog's destructive button.
    fireEvent.click(await screen.findByText("Delete", { selector: "button" }));

    await waitFor(() =>
      expect(mocks.tagDelete).toHaveBeenCalledWith([
        { namespace: "", name: "beach" },
      ]),
    );
  });

  it("merges the selected tags into the chosen target", async () => {
    render();
    await screen.findByText("Manual tags");
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);

    // The toolbar's Merge opens the dialog; the dialog's Merge submits it.
    await screen.findByText("2 selected");
    fireEvent.click(screen.getByText("Merge", { selector: "button" }));

    const dialog = (await screen.findByText("Merge tags")).closest<HTMLElement>(
      '[role="dialog"]',
    )!;
    // The default target is the tag with the most files ("beach", 12).
    fireEvent.click(within(dialog).getByText("Merge", { selector: "button" }));
    await waitFor(() =>
      expect(mocks.tagMerge).toHaveBeenCalledWith(
        [{ namespace: "", name: "holiday" }],
        { namespace: "", name: "beach" },
      ),
    );
  });

  it("applies the tag as a filter and returns to the library", async () => {
    const seen: string[][] = [];
    const onEvent = (e: Event) =>
      seen.push((e as CustomEvent<string[]>).detail);
    window.addEventListener("meguri:apply-tag-filter", onEvent);
    try {
      render();
      fireEvent.click(await screen.findByText("beach"));
      await waitFor(() => expect(screen.getByTestId("home")).toBeTruthy());
      expect(seen).toEqual([["tag:beach"]]);
    } finally {
      window.removeEventListener("meguri:apply-tag-filter", onEvent);
    }
  });

  it("keeps the screen open when Escape dismisses a nested dialog", async () => {
    render();
    await screen.findByText("Manual tags");

    // Radix dialog (rename).
    fireEvent.click(screen.getAllByLabelText("Rename")[0]);
    await screen.findByLabelText("New tag name");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByLabelText("New tag name")).toBeNull(),
    );
    expect(screen.getByText("Manual tags")).toBeTruthy();

    // ConfirmDialog (delete) — a different layer with its own key handling.
    fireEvent.click(screen.getAllByLabelText("Delete")[0]);
    await screen.findByText("Delete", { selector: "button" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(mocks.tagDelete).not.toHaveBeenCalled());
    expect(screen.getByText("Manual tags")).toBeTruthy();
    expect(screen.queryByTestId("home")).toBeNull();
  });

  it("shows the empty state when there are no tags", async () => {
    mocks.tagsListAll.mockResolvedValue({ tags: [], truncated: false });
    render();
    expect(await screen.findByText("No tags yet.")).toBeTruthy();
  });

  it("warns when the catalog was truncated", async () => {
    mocks.tagsListAll.mockResolvedValue({ ...CATALOG, truncated: true });
    render();
    expect(await screen.findByText(/showing the top 2000/)).toBeTruthy();
  });
});
