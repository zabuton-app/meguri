// The pet in the window: poking it, feeding it, its menu, and how it follows
// what the app is doing. The sprite's `data-pet-state` is what it shows.
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { WATCH_LATER_ID } from "@shared/workspaceIds";
import { FILE_DRAG_MIME } from "@/lib/fileDrag";
import { dropPass, parkPass } from "@/routes/Player/detour";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileRow,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

type Listener = (payload?: unknown) => void;

const mocks = vi.hoisted(() => {
  const listeners: Record<string, Listener> = {};
  return {
    appStatus: vi.fn(),
    workspacesList: vi.fn(),
    workspaceSwitch: vi.fn(),
    filesRandom: vi.fn(),
    collectionSetMembership: vi.fn(),
    listeners,
  };
});

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: Object.assign(toast, toasts),
  Toaster: () => null,
}));

vi.mock("@/ipc/client", () => {
  const listen = (name: string) => (cb: Listener) => {
    mocks.listeners[name] = cb;
    return Promise.resolve(() => {});
  };
  return {
    api: {
      appStatus: (): Promise<unknown> => mocks.appStatus() as Promise<unknown>,
      workspacesList: (): Promise<unknown> =>
        mocks.workspacesList() as Promise<unknown>,
      workspaceSwitch: (id: string): Promise<unknown> =>
        mocks.workspaceSwitch(id) as Promise<unknown>,
      filesRandom: (query: unknown): Promise<unknown> =>
        mocks.filesRandom(query) as Promise<unknown>,
      collectionSetMembership: (...args: unknown[]): Promise<unknown> =>
        mocks.collectionSetMembership(...args) as Promise<unknown>,
    },
    events: {
      onScanProgress: listen("scanProgress"),
      onScanDone: listen("scanDone"),
      onWorkspaceChanged: listen("workspaceChanged"),
    },
    ALL_ID: "__all__",
    collectionTarget: (id: string) => `collection:${id}`,
  };
});

const { Pet } = await import("../Pet");

const watchLater = (items: { workspaceId: string; fileId: number }[]) => ({
  ...defaultWorkspacesList,
  collections: [
    {
      id: WATCH_LATER_ID,
      name: "Watch Later",
      active: false,
      items: items.map((i) => ({ ...i, addedAt: 0 })),
      createdAt: 0,
      updatedAt: 0,
      locked: true,
    },
  ],
});

const fileDrag = (files: { workspaceId: string; fileId: number }[]) => ({
  types: [FILE_DRAG_MIME],
  getData: (type: string) =>
    type === FILE_DRAG_MIME ? JSON.stringify(files) : "",
  dropEffect: "none",
});

function setup(props: Partial<Parameters<typeof Pet>[0]> = {}) {
  const onDiscover = vi.fn();
  renderWithProviders(
    <Pet active hasPool onDiscover={onDiscover} {...props} />,
  );
  return { onDiscover };
}

const pet = () => screen.getByRole("button", { name: "Zabuton pet" });
const shown = () =>
  document.querySelector("[data-pet-state]")?.getAttribute("data-pet-state");

async function openMenu() {
  fireEvent.contextMenu(pet());
  return screen.findByRole("menu");
}

describe("Pet", () => {
  beforeEach(() => {
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(watchLater([]));
    mocks.workspaceSwitch.mockReset().mockResolvedValue(undefined);
    mocks.filesRandom.mockReset().mockResolvedValue([]);
    mocks.collectionSetMembership.mockReset().mockResolvedValue({ changed: 1 });
    toast.mockClear();
    dropPass();
  });

  it("stands in the window by default", () => {
    setup();
    expect(pet()).toBeTruthy();
    expect(shown()).toBe("idle");
  });

  it("stays away once it has been put away", () => {
    localStorage.setItem("meguri.prefs", JSON.stringify({ petVisible: false }));
    setup();
    expect(screen.queryByRole("button", { name: "Zabuton pet" })).toBeNull();
  });

  it("is drawn at the chosen size", () => {
    localStorage.setItem("meguri.prefs", JSON.stringify({ petSize: "large" }));
    setup();
    expect(
      document.querySelector("svg[data-pet-state]")?.getAttribute("width"),
    ).toBe(String(24 * 4));
  });

  it("hops when clicked, and only that", async () => {
    const { onDiscover } = setup();
    fireEvent.click(pet());
    expect(shown()).toBe("hop");
    expect(onDiscover).not.toHaveBeenCalled();
    await waitFor(() => expect(shown()).toBe("idle"));
  });

  it("opens Discover on a double-click or Enter", () => {
    const { onDiscover } = setup();
    fireEvent.doubleClick(pet());
    fireEvent.keyDown(pet(), { key: "Enter" });
    expect(onDiscover).toHaveBeenCalledTimes(2);
  });

  it("does not open Discover over an empty list", () => {
    const { onDiscover } = setup({ hasPool: false });
    fireEvent.doubleClick(pet());
    fireEvent.keyDown(pet(), { key: "Enter" });
    expect(onDiscover).not.toHaveBeenCalled();
  });

  it("is held while dragged and lands back on the floor", async () => {
    setup();
    fireEvent.pointerDown(pet(), { button: 0, clientX: 10, clientY: 700 });
    fireEvent.pointerMove(pet(), { clientX: 12, clientY: 700 });
    expect(shown()).toBe("idle");
    fireEvent.pointerMove(pet(), { clientX: 200, clientY: 300 });
    expect(shown()).toBe("held");
    fireEvent.pointerUp(pet());
    // The click a release ends with is not a poke.
    fireEvent.click(pet());
    expect(shown()).toBe("fall");
    await waitFor(() => expect(shown()).toBe("idle"), { timeout: 3000 });
    expect(Number(localStorage.getItem("meguri.pet.x"))).toBeGreaterThan(0);
  });

  it("opens its mouth while files are dragged and eats what is dropped", async () => {
    setup();
    const files = [{ workspaceId: "ws-a", fileId: 1 }];
    fireEvent.dragEnter(document.body, { dataTransfer: fileDrag(files) });
    expect(shown()).toBe("mouthOpen");

    fireEvent.drop(pet(), { dataTransfer: fileDrag(files) });
    expect(shown()).toBe("munch");
    await waitFor(() =>
      expect(mocks.collectionSetMembership).toHaveBeenCalledWith(
        WATCH_LATER_ID,
        [{ workspaceId: "ws-a", fileIds: [1] }],
        "add",
      ),
    );
    // Then it is delighted: happy eyes and hearts.
    await waitFor(() => expect(shown()).toBe("yum"));
    await waitFor(() => expect(shown()).toBe("idle"), { timeout: 3000 });
  });

  it("is not delighted when nothing was added after all", async () => {
    // The list here is stale: the write finds the file already queued.
    mocks.collectionSetMembership.mockResolvedValue({ changed: 0 });
    setup();
    fireEvent.drop(pet(), {
      dataTransfer: fileDrag([{ workspaceId: "ws-a", fileId: 1 }]),
    });
    expect(shown()).toBe("munch");
    await waitFor(() => expect(shown()).toBe("headShake"));
  });

  it("is not delighted when the write fails", async () => {
    mocks.collectionSetMembership.mockRejectedValue(new Error("disk full"));
    setup();
    fireEvent.drop(pet(), {
      dataTransfer: fileDrag([{ workspaceId: "ws-a", fileId: 1 }]),
    });
    await waitFor(() => expect(shown()).toBe("headShake"));
    await waitFor(() => expect(shown()).toBe("idle"), { timeout: 3000 });
  });

  it("begs while the dragged files are held right over it", () => {
    setup();
    const files = [{ workspaceId: "ws-a", fileId: 1 }];
    fireEvent.dragEnter(document.body, { dataTransfer: fileDrag(files) });
    expect(shown()).toBe("mouthOpen");
    fireEvent.dragEnter(pet(), { dataTransfer: fileDrag(files) });
    expect(shown()).toBe("beg");
    // Carried away again without a drop: back to waiting with its mouth open.
    fireEvent.dragLeave(pet(), { dataTransfer: fileDrag(files) });
    expect(shown()).toBe("mouthOpen");
  });

  it("shakes its head when everything dropped is already on Watch Later", async () => {
    const files = [{ workspaceId: "ws-a", fileId: 1 }];
    mocks.workspacesList.mockResolvedValue(watchLater(files));
    mocks.collectionSetMembership.mockResolvedValue({ changed: 0 });
    setup();
    await waitFor(() => expect(mocks.workspacesList).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.drop(pet(), { dataTransfer: fileDrag(files) });
    expect(shown()).toBe("headShake");
  });

  it("works while a scan runs, cheers when it ends, looks around on a switch", async () => {
    setup();
    await waitFor(() => expect(mocks.listeners.scanDone).toBeTruthy());
    act(() => mocks.listeners.scanProgress({ jobId: "a" }));
    act(() => mocks.listeners.scanProgress({ jobId: "a" }));
    expect(shown()).toBe("work");
    act(() => mocks.listeners.scanDone({ jobId: "a" }));
    expect(shown()).toBe("cheer");
    await waitFor(() => expect(shown()).toBe("idle"), { timeout: 3000 });
    act(() => mocks.listeners.workspaceChanged());
    expect(shown()).toBe("lookAround");
  });

  it("keeps working until the last of several scans is done", async () => {
    setup();
    await waitFor(() => expect(mocks.listeners.scanDone).toBeTruthy());
    act(() => mocks.listeners.scanProgress({ jobId: "a" }));
    act(() => mocks.listeners.scanProgress({ jobId: "b" }));
    act(() => mocks.listeners.scanDone({ jobId: "a" }));
    expect(shown()).toBe("work");
    act(() => mocks.listeners.scanDone({ jobId: "b" }));
    expect(shown()).toBe("cheer");
  });

  it("does not cheer for a scan that failed or was called off", async () => {
    setup();
    await waitFor(() => expect(mocks.listeners.scanDone).toBeTruthy());
    act(() => mocks.listeners.scanProgress({ jobId: "a" }));
    act(() => mocks.listeners.scanDone({ jobId: "a", error: true }));
    expect(shown()).toBe("idle");
    act(() => mocks.listeners.scanProgress({ jobId: "a" }));
    act(() => mocks.listeners.scanDone({ jobId: "a", aborted: true }));
    expect(shown()).toBe("idle");
  });

  it("comes down when a drag loses the pointer without a release", async () => {
    setup();
    fireEvent.pointerDown(pet(), { button: 0, clientX: 10, clientY: 700 });
    fireEvent.pointerMove(pet(), { clientX: 200, clientY: 300 });
    expect(shown()).toBe("held");
    fireEvent.lostPointerCapture(pet());
    expect(shown()).toBe("fall");
    await waitFor(() => expect(shown()).toBe("idle"), { timeout: 3000 });
  });

  it("marks keyboard focus, but not focus that follows the mouse", () => {
    setup();
    const mark = () => document.querySelector("[data-pet-focus]");
    fireEvent.pointerDown(document.body);
    fireEvent.focus(pet());
    expect(mark()).toBeNull();
    fireEvent.blur(pet());
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.focus(pet());
    expect(mark()).not.toBeNull();
    fireEvent.blur(pet());
    expect(mark()).toBeNull();
  });

  it("cannot be put away in mid-air", async () => {
    setup();
    fireEvent.pointerDown(pet(), { button: 0, clientX: 10, clientY: 700 });
    fireEvent.pointerMove(pet(), { clientX: 200, clientY: 300 });
    await openMenu();
    expect(
      screen
        .getByRole("menuitem", { name: "Put away" })
        .hasAttribute("data-disabled"),
    ).toBe(true);
  });

  it("rests while a modal covers it", () => {
    setup({ active: false });
    expect(document.querySelector("[data-pet]")?.hasAttribute("inert")).toBe(
      true,
    );
  });

  describe("menu", () => {
    it("offers Discover, the playlist, Watch Later, bringing and putting away", async () => {
      const { onDiscover } = setup();
      const menu = await openMenu();
      expect(menu.textContent).toContain("Discovery");
      expect(menu.textContent).toContain("Play this list");
      expect(menu.textContent).toContain("Play Watch Later");
      expect(menu.textContent).toContain("Bring me something");
      expect(menu.textContent).toContain("Put away");
      expect(menu.textContent).not.toContain("Resume playback");
      fireEvent.click(screen.getByRole("menuitem", { name: "Discovery" }));
      expect(onDiscover).toHaveBeenCalled();
    });

    it("offers to resume only while a pass is parked", async () => {
      parkPass({
        queue: {} as Parameters<typeof parkPass>[0]["queue"],
        key: "ws-a:5",
        sec: 12,
      });
      setup();
      await openMenu();
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Resume playback" }),
      );
      expect(window.location.hash).toBe("#/play?resume=ws-a%3A5");
    });

    it("shows Watch Later before playing it", async () => {
      mocks.workspacesList.mockResolvedValue(
        watchLater([{ workspaceId: "ws-a", fileId: 1 }]),
      );
      setup();
      await waitFor(() => expect(mocks.workspacesList).toHaveBeenCalled());
      await act(async () => {});
      // The switch is held open: the player must not open on the old list.
      let finishSwitch = () => {};
      mocks.workspaceSwitch.mockReturnValue(
        new Promise<void>((resolve) => {
          finishSwitch = resolve;
        }),
      );
      await openMenu();
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Play Watch Later" }),
      );
      await act(async () => {});
      expect(window.location.hash).toBe("#/");
      finishSwitch();
      await waitFor(() => expect(window.location.hash).toBe("#/play"));
      // A collection is switched to by its prefixed target, as the rail does.
      expect(mocks.workspaceSwitch).toHaveBeenCalledWith(
        `collection:${WATCH_LATER_ID}`,
      );
    });

    it("brings a file back with a reason, and opens it from the bubble", async () => {
      mocks.filesRandom.mockImplementation((query: { inProgress?: boolean }) =>
        Promise.resolve(query.inProgress ? [sampleFileRow] : []),
      );
      setup();
      await openMenu();
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Bring me something" }),
      );
      const bubble = await screen.findByRole("status");
      expect(bubble.textContent).toContain("You were partway through this");
      expect(bubble.textContent).toContain("sample.mp4");
      fireEvent.click(bubble.querySelector("button")!);
      expect(window.location.hash).toBe(
        `#/file/${sampleFileRow.id}?ws=${sampleFileRow.workspaceId}`,
      );
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("says so when there is nothing to bring", async () => {
      setup();
      await openMenu();
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Bring me something" }),
      );
      const bubble = await screen.findByRole("status");
      expect(bubble.textContent).toBe("Nothing to bring right now");
      await waitFor(() => expect(shown()).toBe("headShake"));
    });

    it("folds up and hides when put away, pointing at Settings", async () => {
      setup();
      await openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Put away" }));
      expect(shown()).toBe("fold");
      await waitFor(
        () =>
          expect(
            screen.queryByRole("button", { name: "Zabuton pet" }),
          ).toBeNull(),
        { timeout: 3000 },
      );
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining("Settings"),
        expect.objectContaining({
          action: expect.objectContaining({ label: "Settings" }) as unknown,
        }),
      );
      expect(localStorage.getItem("meguri.prefs")).toContain(
        '"petVisible":false',
      );
    });
  });
});
