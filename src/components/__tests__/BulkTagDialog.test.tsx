// The bulk tag dialog's staging rules: what a mixed selection looks like, and
// exactly what gets sent when the edit is applied.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { BulkTagDialog } from "@/components/BulkTagDialog";
import { sampleFileRow } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { FileRow, TagInfo } from "@/ipc/types";
import { MAX_TAG_NAME } from "@shared/tags";

const mocks = vi.hoisted(() => ({
  filesBulkTag: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  tagsList: vi.fn<(...args: unknown[]) => Promise<string[]>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: {
    filesBulkTag: (...args: unknown[]) => mocks.filesBulkTag(...args),
    tagsList: (...args: unknown[]) => mocks.tagsList(...args),
  },
  ALL_ID: "__all__",
}));

const manual = (id: number, name: string): TagInfo => ({
  id,
  name,
  namespace: "",
  source: "manual",
  score: null,
});

const row = (id: number, tags: TagInfo[], workspaceId = "ws-a"): FileRow => ({
  ...sampleFileRow,
  id,
  workspaceId,
  tags,
});

// "beach" is on all three, "trip" on one: the mixed case the screen exists for.
const rows = [
  row(1, [manual(10, "beach"), manual(11, "trip")]),
  row(2, [manual(10, "beach")]),
  row(3, [manual(10, "beach")], "ws-b"),
];

function open(selection: FileRow[] = rows) {
  return renderWithProviders(
    <BulkTagDialog open onOpenChange={() => {}} rows={selection} />,
  );
}

const chip = (name: string) =>
  screen.getByText(name).closest("span") as HTMLElement;

describe("BulkTagDialog", () => {
  beforeEach(() => {
    // The mocks are module-level: without this, a later test reads the calls
    // an earlier one made.
    vi.clearAllMocks();
    mocks.filesBulkTag.mockResolvedValue({
      files: 3,
      skipped: 0,
      added: 3,
      removed: 0,
    });
    mocks.tagsList.mockResolvedValue([]);
  });

  it("shows how much of the selection each tag covers", () => {
    open();
    expect(within(chip("beach")).getByText("3/3")).toBeTruthy();
    expect(within(chip("trip")).getByText("1/3")).toBeTruthy();
  });

  it("cannot apply an edit that stages nothing", () => {
    open();
    expect(
      screen
        .getByRole("button", { name: "Apply to 3" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("raises a partial tag to the whole selection", async () => {
    open();
    fireEvent.click(screen.getByTitle("Put “trip” on every selected file"));
    // Staged as an addition, and the count now reads as if it had landed.
    expect(within(chip("trip")).getByText("3/3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Apply to 3" }));
    await waitFor(() => expect(mocks.filesBulkTag).toHaveBeenCalled());
    expect(mocks.filesBulkTag.mock.calls[0][1]).toEqual(["trip"]);
    expect(mocks.filesBulkTag.mock.calls[0][2]).toEqual([]);
  });

  it("tells its caller once the edit is written", async () => {
    // The caller re-reads the rows no list refetch covers (a picked folder's).
    const onApplied = vi.fn();
    renderWithProviders(
      <BulkTagDialog
        open
        onOpenChange={() => {}}
        rows={rows}
        onApplied={onApplied}
      />,
    );
    fireEvent.click(screen.getByTitle("Put “trip” on every selected file"));
    expect(onApplied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply to 3" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  });

  it("stages a removal and lets it be taken back", () => {
    open();
    fireEvent.click(
      screen.getByTitle("Remove “beach” from every selected file"),
    );
    const revert = screen.getByTitle("Keep “beach”");
    expect(revert).toBeTruthy();
    fireEvent.click(revert);
    expect(
      screen.getByTitle("Remove “beach” from every selected file"),
    ).toBeTruthy();
  });

  it("sends typed names as additions, grouped by workspace", async () => {
    open();
    const input = screen.getByLabelText("Add a tag");
    fireEvent.change(input, { target: { value: "camp" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(
      screen.getByTitle("Remove “beach” from every selected file"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply to 3" }));

    await waitFor(() => expect(mocks.filesBulkTag).toHaveBeenCalled());
    const [targets, add, remove] = mocks.filesBulkTag.mock.calls[0] as [
      { workspaceId: string; fileIds: number[] }[],
      string[],
      string[],
    ];
    expect(targets).toEqual([
      { workspaceId: "ws-a", fileIds: [1, 2] },
      { workspaceId: "ws-b", fileIds: [3] },
    ]);
    expect(add).toEqual(["camp"]);
    expect(remove).toEqual(["beach"]);
  });

  it("does not stage the same name twice", () => {
    open();
    const input = screen.getByLabelText("Add a tag");
    for (let i = 0; i < 2; i++) {
      fireEvent.change(input, { target: { value: "camp" } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    expect(screen.getByText("1 to add / 0 to remove")).toBeTruthy();
  });

  it("an addition cancels a pending removal of the same name", () => {
    open();
    fireEvent.click(
      screen.getByTitle("Remove “beach” from every selected file"),
    );
    const input = screen.getByLabelText("Add a tag");
    fireEvent.change(input, { target: { value: "beach" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("1 to add / 0 to remove")).toBeTruthy();
  });

  it("still takes a known name while the field holds an over-long draft", () => {
    // The length rule applies to the name being staged. Judging the click by
    // the draft in the input would make the chip look broken.
    open();
    const input = screen.getByLabelText("Add a tag");
    fireEvent.change(input, {
      target: { value: "x".repeat(MAX_TAG_NAME + 1) },
    });
    fireEvent.click(screen.getByTitle("Put “trip” on every selected file"));
    expect(screen.getByText("1 to add / 0 to remove")).toBeTruthy();
  });

  it("keeps a typed draft when raising an existing tag", () => {
    open();
    const input = screen.getByLabelText("Add a tag");
    fireEvent.change(input, { target: { value: "half-typed" } });
    fireEvent.click(screen.getByTitle("Put “trip” on every selected file"));
    expect((input as HTMLInputElement).value).toBe("half-typed");
  });

  it("refuses a name longer than the cap", () => {
    open();
    const input = screen.getByLabelText("Add a tag");
    fireEvent.change(input, {
      target: { value: "y".repeat(MAX_TAG_NAME + 1) },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("0 to add / 0 to remove")).toBeTruthy();
  });

  it("says so when the selection carries no editable tags", () => {
    open([row(1, [])]);
    expect(screen.getByText("No tags")).toBeTruthy();
  });
});
