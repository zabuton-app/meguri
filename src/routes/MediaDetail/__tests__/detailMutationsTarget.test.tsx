// The detail view stays mounted across prev/next, so an action has to keep
// acting on the file it was started on, not on the one shown when it runs or
// settles (#258).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import type { FileDetail, FileRow } from "@/ipc/types";
import {
  createTestQueryClient,
  renderWithProviders,
} from "@/test/renderWithProviders";
import { useDetailMutations, type DetailActions } from "../useDetailMutations";

const WS = "ws-test";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn<() => Promise<boolean>>(),
  fileDeleteFromIndex: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
  thumbSetOffset: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
  fileSetRating: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
  bookmarkAdd: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
  bookmarkRemove: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@/components/ConfirmDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ConfirmDialog")>()),
  useConfirm: () => mocks.confirm,
}));
vi.mock("@/ipc/client", () => ({
  api: {
    fileDeleteFromIndex: (...a: unknown[]) => mocks.fileDeleteFromIndex(...a),
    thumbSetOffset: (...a: unknown[]) => mocks.thumbSetOffset(...a),
    fileSetRating: (...a: unknown[]) => mocks.fileSetRating(...a),
    bookmarkAdd: (...a: unknown[]) => mocks.bookmarkAdd(...a),
    bookmarkRemove: (...a: unknown[]) => mocks.bookmarkRemove(...a),
  },
}));

/** A promise and the function that settles it. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const qc = createTestQueryClient();
  const onIndexEntryRemoved = vi.fn();
  const onDeleteFinished = vi.fn();
  let actions!: DetailActions;
  function Probe({ fileId }: { fileId: number }) {
    actions = useDetailMutations({
      fileId,
      wsId: WS,
      fileName: `file-${fileId}.mp4`,
      onIndexEntryRemoved,
      onDeleteFinished,
    });
    return null;
  }
  const view = renderWithProviders(<Probe fileId={1} />, { queryClient: qc });
  return {
    qc,
    onIndexEntryRemoved,
    onDeleteFinished,
    actions: () => actions,
    show: (fileId: number) => view.rerender(<Probe fileId={fileId} />),
  };
}

const detail = (id: number, thumbOffsetSec: number | null) =>
  ({ id, thumbOffsetSec }) as unknown as FileDetail;

describe("detail actions across prev/next", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes the file the dialog was opened for, and keeps the next one open", async () => {
    const answer = deferred<boolean>();
    mocks.confirm.mockReturnValue(answer.promise);
    mocks.fileDeleteFromIndex.mockResolvedValue({ id: 1, relPath: "a.mp4" });
    const t = setup();

    let done!: Promise<void>;
    act(() => {
      done = t.actions().deleteFromIndex();
    });
    t.show(2); // "]" while the dialog is open
    await act(async () => {
      answer.resolve(true);
      await done;
    });

    expect(mocks.fileDeleteFromIndex).toHaveBeenCalledWith(1, WS);
    expect(t.onIndexEntryRemoved).toHaveBeenCalledExactlyOnceWith({
      fileId: 1,
      wsId: WS,
    });
    expect(t.onDeleteFinished).not.toHaveBeenCalled();
    // The dialog named the file it was opened for.
    expect(mocks.confirm.mock.calls[0]).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("file-1.mp4") as unknown,
      }),
    ]);
  });

  it("closes the view when it still shows the removed file", async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.fileDeleteFromIndex.mockResolvedValue({ id: 1, relPath: "a.mp4" });
    const t = setup();

    await act(() => t.actions().deleteFromIndex());

    expect(mocks.fileDeleteFromIndex).toHaveBeenCalledWith(1, WS);
    expect(t.onDeleteFinished).toHaveBeenCalledTimes(1);
  });

  it("rolls a failed main thumbnail back on the file it was set on", async () => {
    const res = deferred<{ thumbOffsetSec: number | null }>();
    mocks.thumbSetOffset.mockReturnValue(res.promise);
    const t = setup();
    t.qc.setQueryData(["file_get", WS, 1], detail(1, 5));
    t.qc.setQueryData(["file_get", WS, 2], detail(2, 9));

    act(() => t.actions().setMainThumb(30));
    await waitFor(() =>
      expect(t.qc.getQueryData<FileDetail>(["file_get", WS, 1])).toMatchObject({
        thumbOffsetSec: 30,
      }),
    );
    t.show(2);
    await act(async () => {
      res.reject(new Error("ffmpeg failed"));
      await res.promise.catch(() => {});
    });

    await waitFor(() =>
      expect(t.qc.getQueryData<FileDetail>(["file_get", WS, 1])).toMatchObject({
        thumbOffsetSec: 5,
      }),
    );
    expect(t.qc.getQueryData<FileDetail>(["file_get", WS, 2])).toMatchObject({
      thumbOffsetSec: 9,
    });
    expect(mocks.thumbSetOffset).toHaveBeenCalledWith(1, WS, 30);
  });

  it("does not show another file's pending main thumbnail as this one's", async () => {
    mocks.thumbSetOffset.mockReturnValue(new Promise(() => {}));
    const t = setup();

    act(() => t.actions().setMainThumb(30));
    await waitFor(() => expect(t.actions().pendingThumbSec).toBe(30));
    t.show(2);

    expect(t.actions().pendingThumbSec).toBeUndefined();
    expect(t.actions().pending.mainThumb).toBe(false);
  });
});

describe("bookmark edits reach the list rows", () => {
  beforeEach(() => vi.clearAllMocks());

  const listRow = () =>
    ({ id: 1, workspaceId: WS, bookmarkSecs: [30] }) as unknown as FileRow;

  it("adds and removes the bookmark's seconds on the cached search rows", async () => {
    const t = setup();
    t.qc.setQueryData(["file_get", WS, 1], {
      id: 1,
      bookmarks: [{ id: 9, sec: 30, createdAt: 0 }],
    });
    t.qc.setQueryData(["files_search", "k"], {
      pages: [{ items: [listRow()], nextCursor: null }],
      pageParams: [0],
    });
    const rowSecs = () =>
      t.qc.getQueryData<{ pages: { items: FileRow[] }[] }>([
        "files_search",
        "k",
      ])?.pages[0].items[0].bookmarkSecs;

    mocks.bookmarkAdd.mockResolvedValue({ id: 10, sec: 5, createdAt: 0 });
    act(() => t.actions().addBookmark(5));
    await waitFor(() => expect(rowSecs()).toEqual([5, 30]));

    mocks.bookmarkRemove.mockResolvedValue(undefined);
    act(() => t.actions().removeBookmark(9));
    await waitFor(() => expect(rowSecs()).toEqual([5]));
  });

  it("reaches the other copies of the same content too", async () => {
    const t = setup();
    t.qc.setQueryData(["file_get", WS, 1], {
      id: 1,
      contentHash: "same",
      bookmarks: [],
    });
    const rows = [
      { id: 1, workspaceId: WS, contentHash: "same", bookmarkSecs: [] },
      // A copy in another workspace: bookmarks follow the content.
      { id: 7, workspaceId: "ws-other", contentHash: "same", bookmarkSecs: [] },
      { id: 8, workspaceId: WS, contentHash: "different", bookmarkSecs: [] },
    ] as unknown as FileRow[];
    t.qc.setQueryData(["files_search", "k"], {
      pages: [{ items: rows, nextCursor: null }],
      pageParams: [0],
    });
    const secs = () =>
      t.qc
        .getQueryData<{ pages: { items: FileRow[] }[] }>(["files_search", "k"])
        ?.pages[0].items.map((r) => r.bookmarkSecs);

    mocks.bookmarkAdd.mockResolvedValue({ id: 10, sec: 5, createdAt: 0 });
    act(() => t.actions().addBookmark(5));
    await waitFor(() => expect(secs()).toEqual([[5], [5], []]));
  });
});
