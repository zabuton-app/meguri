import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => "linux"),
  close: vi.fn(),
}));
vi.mock("@/lib/platform", () => ({ platform: () => mocks.platform() }));
vi.mock("@/ipc/client", () => ({ api: { windowClose: () => mocks.close() } }));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn() } }));

const { ErrorBoundary } = await import("@/components/ErrorBoundary");

function Boom(): never {
  throw new Error("boom");
}

beforeEach(() => {
  vi.clearAllMocks();
  // React reports the caught error on the console; the boundary is the point.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// The custom title bar goes down with the app, and on Windows and Linux the
// window has no buttons of its own (#578).
describe("ErrorBoundary's crash screen", () => {
  it("keeps a way to close the window on Windows and Linux", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("leaves closing to the traffic lights on macOS", () => {
    mocks.platform.mockReturnValue("darwin");
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    screen.getByRole("button", { name: "Reload" });
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
