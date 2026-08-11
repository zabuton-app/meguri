// The bar's job is that no condition is ever applied invisibly: what is on the
// primary row shows in its own control, and what is folded into the panel shows
// as a count on the trigger.
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { SearchQuery } from "@/ipc/types";

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () =>
      Promise.resolve({ ready: true, workspaceId: "ws-test", root: "/m" }),
    tagsListAll: () => Promise.resolve({ tags: [], truncated: false }),
  },
  ALL_ID: "__all__",
}));

const { FilterBar } = await import("@/components/FilterBar");
const { I18nProvider } = await import("@/i18n/I18nProvider");

function setup(initial: SearchQuery = {}) {
  const seen = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [q, setQ] = useState<SearchQuery>(initial);
    return (
      <QueryClientProvider client={qc}>
        <I18nProvider>
          <FilterBar
            value={q}
            onChange={(next) => {
              seen(next);
              setQ(next);
            }}
          />
        </I18nProvider>
      </QueryClientProvider>
    );
  }
  render(<Harness />);
  return {
    seen,
    latest: () => seen.mock.calls.at(-1)?.[0] as SearchQuery | undefined,
  };
}

const badge = () => document.querySelector('[data-slot="more-filters-badge"]');
const trigger = () =>
  document.querySelector('[data-slot="more-filters-trigger"]') as HTMLElement;
const panel = () => document.querySelector('[data-slot="more-filters-panel"]');
const chips = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="filter-chip"]'),
  );

describe("collapsed-condition badge", () => {
  it("is absent from the DOM when nothing is folded away", () => {
    setup({});
    // Absent, not rendered empty — an empty pill would read as a live count.
    expect(badge()).toBeNull();
  });

  it("does not count conditions that are visible on the primary row", () => {
    setup({ kind: "video", favorite: true, ratingMin: 3 });
    expect(badge()).toBeNull();
  });

  it("counts a condition set inside the panel", () => {
    setup({ played: false });
    expect(badge()?.textContent).toBe("1");
  });

  it("counts a non-default sort even though it gets no chip", () => {
    setup({ played: false, sort: "name" });
    expect(badge()?.textContent).toBe("2");
  });

  it("names the count in the trigger's accessible name", () => {
    setup({ played: false });
    expect(trigger().getAttribute("aria-label")).toContain("1");
  });
});

describe("kind segments", () => {
  it("exposes exactly one checked radio", () => {
    setup({ kind: "video" });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(
      radios.filter((r) => r.getAttribute("aria-checked") === "true"),
    ).toHaveLength(1);
  });

  it("defaults to the neutral segment when no kind is set", () => {
    setup({});
    expect(screen.getAllByRole("radio")[0].getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("selects a kind on click", () => {
    const { latest } = setup({});
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(latest()?.kind).toBe("video");
  });

  it("moves selection with the arrow keys, and focus with it", () => {
    const { latest } = setup({});
    fireEvent.keyDown(screen.getAllByRole("radio")[0], { key: "ArrowRight" });
    expect(latest()?.kind).toBe("video");
    // Roving tabindex only works if focus follows selection; without this the
    // focus move could break silently.
    expect(document.activeElement).toBe(screen.getAllByRole("radio")[1]);
  });

  it("jumps to the ends with Home and End", () => {
    const { latest } = setup({ kind: "video" });
    fireEvent.keyDown(screen.getAllByRole("radio")[1], { key: "End" });
    expect(latest()?.kind).toBe("image");
    fireEvent.keyDown(screen.getAllByRole("radio")[2], { key: "Home" });
    expect(latest()?.kind).toBeUndefined();
  });

  it("keeps the group reachable when the query carries an unknown kind", () => {
    // A saved search can hold any string. With no segment matching, roving
    // tabindex would put -1 on every button and strand the group off the Tab
    // order, so the neutral segment takes the focusable slot.
    setup({ kind: "audio" });
    const radios = screen.getAllByRole("radio");
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
  });
});

describe("the panel", () => {
  it("opens from its trigger and closes on Escape", async () => {
    setup({});
    expect(panel()).toBeNull();

    fireEvent.click(trigger());
    await waitFor(() => expect(panel()).not.toBeNull());

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(panel()).toBeNull());
  });

  it("sets the play state from its segmented control", async () => {
    const { latest } = setup({});
    fireEvent.click(trigger());
    await waitFor(() => expect(panel()).not.toBeNull());

    const playGroup = document.querySelector(
      '[data-slot="play-state-group"]',
    ) as HTMLElement;
    const segments = within(playGroup).getAllByRole("radio");
    expect(segments).toHaveLength(3);
    expect(segments[0].getAttribute("aria-checked")).toBe("true");

    fireEvent.click(segments[2]);
    expect(latest()?.played).toBe(false);
    expect(badge()?.textContent).toBe("1");
  });

  it("keeps a condition set inside it applied after it closes", async () => {
    const { latest } = setup({});
    fireEvent.click(trigger());
    await waitFor(() => expect(panel()).not.toBeNull());

    // The duplicates toggle is the one panel control jsdom can drive directly;
    // the selects are Radix widgets that need real pointer events.
    const duplicates = screen
      .getAllByRole("button", { pressed: false })
      .find((el) => el.closest('[data-slot="more-filters-panel"]'));
    fireEvent.click(duplicates!);
    expect(latest()?.duplicates).toBe(true);

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(panel()).toBeNull());

    // Still applied, and now reported by the badge: duplicates also selects the
    // hash sort, so two conditions are genuinely on.
    expect(badge()?.textContent).toBe("2");
  });
});

describe("saved searches", () => {
  it("applies a saved query and updates the chips and the badge together", async () => {
    localStorage.setItem(
      "meguri.smartCollections.v1",
      JSON.stringify([
        {
          id: "sc-1",
          name: "Unplayed videos",
          query: { kind: "video", played: false },
          createdAt: 0,
          updatedAt: 0,
        },
      ]),
    );
    const { latest } = setup({});

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Smart collections" }),
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );
    fireEvent.click(await screen.findByText("Unplayed videos"));

    await waitFor(() => expect(latest()?.kind).toBe("video"));
    expect(latest()?.played).toBe(false);
    // Both read-back surfaces come from the same derivation, so neither can lag.
    expect(chips()).toHaveLength(2);
    expect(badge()?.textContent).toBe("1");
  });
});

describe("the chip row", () => {
  it("is absent from the DOM when nothing is filtering", () => {
    setup({});
    expect(chips()).toHaveLength(0);
  });

  it("shows one chip per active condition, from both the row and the panel", () => {
    setup({ kind: "video", favorite: true, played: false });
    expect(chips()).toHaveLength(3);
  });

  it("reports a non-default sort as both a badge count and a named chip", () => {
    setup({ sort: "name" });
    expect(badge()?.textContent).toBe("1");
    // The badge alone says only that something is set inside the panel.
    expect(chips().map((c) => c.textContent)).toEqual([
      expect.stringContaining("Sort order"),
    ]);
  });

  it("restores the default sort when its chip is removed", () => {
    const { latest } = setup({ sort: "name", sortDir: "asc", kind: "video" });
    const sortChip = chips().find((c) => c.textContent?.includes("Sort order"));
    fireEvent.click(within(sortChip!).getByRole("button"));

    expect(latest()?.sort).toBeUndefined();
    expect(latest()?.sortDir).toBeUndefined();
    expect(latest()?.kind).toBe("video");
  });

  it("removes only its own condition", () => {
    const { latest } = setup({ kind: "video", favorite: true });
    const kindChip = chips().find((c) => c.textContent?.includes("Video"));
    fireEvent.click(within(kindChip!).getByRole("button"));

    expect(latest()?.kind).toBeUndefined();
    expect(latest()?.favorite).toBe(true);
  });

  it("clears free text without disturbing the tag directives beside it", () => {
    const { latest } = setup({ q: "sunset tag:beach" });
    const textChip = chips().find((c) => c.textContent?.includes("sunset"));
    fireEvent.click(within(textChip!).getByRole("button"));

    expect(latest()?.q).toBe("tag:beach");
  });

  it("gives a tag directive its own chip, duplicating the search box on purpose", () => {
    // The row is meant to be the whole answer to "what is narrowing this list";
    // a condition visible only inside another control is one you have to know
    // to go looking for.
    const { latest } = setup({ q: "sunset tag:beach" });
    const tagChip = chips().find((c) => c.textContent?.includes("beach"));
    expect(tagChip).toBeTruthy();

    fireEvent.click(within(tagChip!).getByRole("button"));
    expect(latest()?.q).toBe("sunset");
  });

  it("keeps clear-all outside the scrolling chips", () => {
    setup({ q: "sunset tag:beach", kind: "video", favorite: true });
    const track = document.querySelector('[data-slot="filter-chip-track"]');
    expect(track).not.toBeNull();
    // Every chip scrolls; the way out of the filter set does not.
    for (const chip of chips()) expect(track!.contains(chip)).toBe(true);
    expect(track!.contains(screen.getByText("Clear all"))).toBe(false);
  });

  it("clears everything at once, search text included", () => {
    const { latest } = setup({ q: "sunset", kind: "video", played: false });
    fireEvent.click(screen.getByText("Clear all"));

    expect(latest()).toEqual({});
    expect(chips()).toHaveLength(0);
    expect(badge()).toBeNull();
  });
});
