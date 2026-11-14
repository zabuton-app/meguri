// Focus stays in an open modal and goes back where it came from (#287).
import { StrictMode, useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useModalFocus } from "@/hooks/useModalFocus";

function Modal({ active = true }: { active?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, { active });
  return (
    <div ref={panelRef} tabIndex={-1} data-testid="panel">
      <button type="button">first</button>
      <button type="button">last</button>
    </div>
  );
}

function App({ active = true }: { active?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        close
      </button>
      {open && <Modal active={active} />}
    </>
  );
}

const tab = (shiftKey = false) =>
  fireEvent.keyDown(document.activeElement ?? window, { key: "Tab", shiftKey });

describe("useModalFocus", () => {
  it("moves focus into the panel and back to the opener on close", () => {
    render(<App />);
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByTestId("panel"));

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(document.activeElement).toBe(opener);
  });

  it("remembers the opener across StrictMode's double effect run", () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(document.activeElement).toBe(opener);
  });

  it("cycles Tab inside the panel", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    // From the panel itself, Shift+Tab goes round to the last item.
    tab(true);
    expect(document.activeElement?.textContent).toBe("last");
    tab();
    expect(document.activeElement?.textContent).toBe("first");
    tab(true);
    expect(document.activeElement?.textContent).toBe("last");
  });

  it("pulls focus that fell to <body> back into the panel", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    (document.activeElement as HTMLElement).blur();
    tab();
    expect(document.activeElement?.textContent).toBe("first");
  });

  it("leaves Tab to a layer laid over the panel", () => {
    render(
      <>
        <App />
        <button type="button">over</button>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    const over = screen.getByRole("button", { name: "over" });
    over.focus();
    tab();
    expect(document.activeElement).toBe(over);
  });

  it("does nothing while inactive", () => {
    render(<App active={false} />);
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(opener);
  });

  it("keeps focus where it is when the panel stops being a modal", () => {
    const view = (show: boolean, active: boolean) => (
      <>
        <button type="button">outside</button>
        {show && <Modal active={active} />}
      </>
    );
    const { rerender } = render(view(false, true));
    screen.getByRole("button", { name: "outside" }).focus();
    rerender(view(true, true));
    const first = screen.getByRole("button", { name: "first" });
    first.focus();
    rerender(view(true, false));
    expect(document.activeElement).toBe(first);
  });

  it("returns to the peek's opener after the peek turned into the modal", () => {
    const view = (show: boolean, active: boolean) => (
      <>
        <button type="button">outside</button>
        {show && <Modal active={active} />}
      </>
    );
    const { rerender } = render(view(false, false));
    const outside = screen.getByRole("button", { name: "outside" });
    outside.focus();
    rerender(view(true, false));
    screen.getByRole("button", { name: "first" }).focus();
    rerender(view(true, true));
    rerender(view(false, true));
    expect(document.activeElement).toBe(outside);
  });
});
