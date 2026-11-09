import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { HashLink } from "@/components/HashLink";

function setup(initial = "/") {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <HashLink to="/file/3?ws=w" onClick={() => {}}>
            open
          </HashLink>
        ),
      },
    ],
    { initialEntries: [initial] },
  );
  render(<RouterProvider router={router} />);
  return { router, link: screen.getByRole("link", { name: "open" }) };
}

describe("HashLink", () => {
  it("writes the path behind a hash, as the hash history would", () => {
    const { link } = setup();
    expect(link.getAttribute("href")).toBe("#/file/3?ws=w");
  });

  it("navigates in the app on a plain click", () => {
    const { router, link } = setup();
    fireEvent.click(link);
    expect(router.state.location.pathname).toBe("/file/3");
    expect(router.state.location.search).toBe("?ws=w");
    expect(router.state.historyAction).toBe("PUSH");
  });

  it("leaves modified clicks to the browser", () => {
    const { router, link } = setup();
    fireEvent.click(link, { ctrlKey: true });
    expect(router.state.location.pathname).toBe("/");
  });

  it("does nothing once a handler has taken the click", () => {
    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: (
            <HashLink to="/file/3" onClick={(e) => e.preventDefault()}>
              open
            </HashLink>
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    fireEvent.click(screen.getByRole("link", { name: "open" }));
    expect(router.state.location.pathname).toBe("/");
  });

  it("replaces rather than pushes the place already shown", () => {
    window.location.hash = "#/file/3?ws=w";
    try {
      const { router, link } = setup("/file/3?ws=w");
      fireEvent.click(link);
      expect(router.state.historyAction).toBe("REPLACE");
    } finally {
      window.location.hash = "";
    }
  });
});
