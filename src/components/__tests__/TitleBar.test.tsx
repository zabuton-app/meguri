import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import type { WindowState } from "@shared/ipc/channels";
import { renderWithProviders } from "@/test/renderWithProviders";

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => "linux"),
  state: vi.fn<() => Promise<WindowState>>(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  doubleClick: vi.fn(),
  setButtonPosition: vi.fn<(x: number, y: number) => Promise<void>>(),
  setButtonVisibility: vi.fn<(visible: boolean) => Promise<void>>(),
  listener: null as ((s: WindowState) => void) | null,
}));
vi.mock("@/lib/platform", () => ({ platform: () => mocks.platform() }));
vi.mock("@/hooks/useLogo", () => ({
  useLogo: () => ({ logo: "default" }),
  useLogoImages: () => ({ default: "logo.png" }),
}));
vi.mock("@/ipc/client", () => ({
  api: {
    windowState: () => mocks.state(),
    windowMinimize: () => mocks.minimize(),
    windowToggleMaximize: () => mocks.toggleMaximize(),
    windowClose: () => mocks.close(),
    windowTitleBarDoubleClick: () => mocks.doubleClick(),
    windowSetButtonPosition: (x: number, y: number) =>
      mocks.setButtonPosition(x, y),
    windowSetButtonVisibility: (visible: boolean) =>
      mocks.setButtonVisibility(visible),
  },
  events: {
    onWindowState: (cb: (s: WindowState) => void) => {
      mocks.listener = cb;
      return () => {
        mocks.listener = null;
      };
    },
  },
}));

const { TitleBar } = await import("@/components/TitleBar");
const { TitleBarPortal } = await import("@/components/titleBarSlot");
const { TitleBarSlot } = await import("@/components/titleBarSlotContext");
const { holdImmersiveView } = await import("@/components/immersiveView");

const restored: WindowState = { maximized: false, fullScreen: false };

/** Save the window buttons' side the way the settings do. */
function chooseSide(side: "left" | "right" | "none"): void {
  localStorage.setItem("meguri.prefs", JSON.stringify({ windowButtons: side }));
}

/** The names of the bar's buttons, in order. */
function buttonNames(): string[] {
  return screen
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform.mockReturnValue("linux");
  mocks.state.mockResolvedValue(restored);
  mocks.setButtonPosition.mockResolvedValue();
  mocks.setButtonVisibility.mockResolvedValue();
});

describe("TitleBar on Windows and Linux", () => {
  it("draws the window buttons and sends each one to main", async () => {
    renderWithProviders(<TitleBar />);
    fireEvent.click(await screen.findByRole("button", { name: "Minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(mocks.minimize).toHaveBeenCalledTimes(1);
    expect(mocks.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("puts them after the slot, close last, when set to the right, with the logo first", async () => {
    chooseSide("right");
    renderWithProviders(<TitleBar />);
    await screen.findByRole("button", { name: "Close" });
    expect(buttonNames()).toEqual(["Minimize", "Maximize", "Close"]);
    const bar = screen.getByTestId("title-bar");
    expect(bar.lastElementChild?.contains(screen.getByLabelText("Close"))).toBe(
      true,
    );
    expect(bar.firstElementChild?.contains(screen.getByRole("img"))).toBe(true);
  });

  it("puts them first, close first, when set to the left, leaving the logo to the rail", async () => {
    chooseSide("left");
    renderWithProviders(<TitleBar />);
    await screen.findByRole("button", { name: "Close" });
    expect(buttonNames()).toEqual(["Close", "Minimize", "Maximize"]);
    const bar = screen.getByTestId("title-bar");
    expect(
      bar.firstElementChild?.contains(screen.getByLabelText("Close")),
    ).toBe(true);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("draws none when set to none, keeping the logo", async () => {
    chooseSide("none");
    renderWithProviders(<TitleBar />);
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();
    screen.getByRole("img");
  });

  it("hides them, keeping their room, while an immersive view covers the bar", async () => {
    renderWithProviders(<TitleBar />);
    const group = (await screen.findByRole("button", { name: "Close" }))
      .parentElement!;
    expect(group.classList).not.toContain("invisible");
    let release = () => {};
    act(() => {
      release = holdImmersiveView();
    });
    expect(group.classList).toContain("invisible");
    act(() => release());
    expect(group.classList).not.toContain("invisible");
  });

  it("offers restore while the window is maximized", async () => {
    mocks.state.mockResolvedValue({ maximized: true, fullScreen: false });
    renderWithProviders(<TitleBar />);
    await screen.findByRole("button", { name: "Restore" });
    act(() => mocks.listener?.(restored));
    screen.getByRole("button", { name: "Maximize" });
  });

  it("keeps a state change that arrives before the first answer", async () => {
    let answer: (s: WindowState) => void = () => {};
    mocks.state.mockReturnValue(new Promise((r) => (answer = r)));
    renderWithProviders(<TitleBar />);
    act(() => mocks.listener?.({ maximized: true, fullScreen: false }));
    await act(async () => answer(restored));
    screen.getByRole("button", { name: "Restore" });
  });

  it("leaves a double click to the OS", () => {
    renderWithProviders(<TitleBar />);
    fireEvent.doubleClick(screen.getByTestId("title-bar"));
    expect(mocks.doubleClick).not.toHaveBeenCalled();
  });

  it("hands its slot to the screen's header", () => {
    let slot: HTMLElement | null = null;
    renderWithProviders(<TitleBar slotRef={(el) => void (slot = el)} />);
    expect(slot).not.toBeNull();
    expect(slot!.hasAttribute("data-title-bar-slot")).toBe(true);
  });
});

describe("TitleBar on macOS", () => {
  beforeEach(() => mocks.platform.mockReturnValue("darwin"));

  it("draws no window buttons, leaves room for the traffic lights, shows and moves them there", async () => {
    chooseSide("left");
    renderWithProviders(<TitleBar />);
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();
    const bar = screen.getByTestId("title-bar");
    expect(bar.firstElementChild).toBe(
      screen.getByTestId("traffic-lights-room"),
    );
    expect(mocks.setButtonPosition).toHaveBeenCalled();
    expect(mocks.setButtonVisibility).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("hides the traffic lights, and their room, when set to none", async () => {
    chooseSide("none");
    renderWithProviders(<TitleBar />);
    await act(async () => {});
    expect(mocks.setButtonVisibility).toHaveBeenLastCalledWith(false);
    expect(screen.queryByTestId("traffic-lights-room")).toBeNull();
    screen.getByRole("img");
  });

  it("hides the traffic lights while an immersive view covers the bar", async () => {
    chooseSide("left");
    renderWithProviders(<TitleBar />);
    await act(async () => {});
    expect(mocks.setButtonVisibility).toHaveBeenLastCalledWith(true);
    let release = () => {};
    act(() => {
      release = holdImmersiveView();
    });
    expect(mocks.setButtonVisibility).toHaveBeenLastCalledWith(false);
    act(() => release());
    expect(mocks.setButtonVisibility).toHaveBeenLastCalledWith(true);
  });

  it("moves the traffic lights to the right end when set there", async () => {
    chooseSide("right");
    renderWithProviders(<TitleBar />);
    await act(async () => {});
    const bar = screen.getByTestId("title-bar");
    expect(bar.lastElementChild).toBe(
      screen.getByTestId("traffic-lights-room"),
    );
  });

  it("places the traffic lights again on a resize", async () => {
    renderWithProviders(<TitleBar />);
    await act(async () => {});
    mocks.setButtonPosition.mockClear();
    window.dispatchEvent(new Event("resize"));
    expect(mocks.setButtonPosition).toHaveBeenCalledTimes(1);
  });

  it("drops the room in full screen, where the traffic lights are hidden", async () => {
    renderWithProviders(<TitleBar />);
    await act(async () => {});
    act(() => mocks.listener?.({ maximized: false, fullScreen: true }));
    expect(screen.queryByTestId("traffic-lights-room")).toBeNull();
  });

  it("hands a double click on the bar to main, the header's included, but not one on a control", () => {
    // The header reaches the bar through a portal, as Home's does.
    function Shell() {
      const [slot, setSlot] = useState<HTMLElement | null>(null);
      return (
        <TitleBarSlot.Provider value={slot}>
          <TitleBar slotRef={setSlot} />
          <TitleBarPortal>
            <span>All</span>
            <button type="button">Scan</button>
            {/* A control area, like Home's search box with its chips. */}
            <div data-title-bar-control="">
              <span>tag:beach</span>
            </div>
          </TitleBarPortal>
        </TitleBarSlot.Provider>
      );
    }
    renderWithProviders(<Shell />);
    fireEvent.doubleClick(screen.getByTestId("title-bar"));
    expect(mocks.doubleClick).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(screen.getByText("All"));
    expect(mocks.doubleClick).toHaveBeenCalledTimes(2);
    fireEvent.doubleClick(screen.getByRole("button", { name: "Scan" }));
    fireEvent.doubleClick(screen.getByText("tag:beach"));
    expect(mocks.doubleClick).toHaveBeenCalledTimes(2);
  });

  it("hides the traffic lights again on leaving full screen, which shows them", async () => {
    chooseSide("none");
    renderWithProviders(<TitleBar />);
    await act(async () => {});
    act(() => mocks.listener?.({ maximized: false, fullScreen: true }));
    mocks.setButtonVisibility.mockClear();
    act(() => mocks.listener?.(restored));
    expect(mocks.setButtonVisibility).toHaveBeenCalledWith(false);
  });

  it("keeps them hidden on leaving full screen while an immersive view is open", async () => {
    chooseSide("left");
    renderWithProviders(<TitleBar />);
    await act(async () => {});
    let release = () => {};
    act(() => {
      release = holdImmersiveView();
    });
    act(() => mocks.listener?.({ maximized: false, fullScreen: true }));
    mocks.setButtonVisibility.mockClear();
    act(() => mocks.listener?.(restored));
    expect(mocks.setButtonVisibility).toHaveBeenLastCalledWith(false);
    act(() => release());
  });
});
