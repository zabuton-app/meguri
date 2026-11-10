// Effects asked for from outside a file's controls (#303): the controls of the
// files named play them, other files' do not, a value change alone still
// plays nothing, and a control mounted after an effect is over does not
// replay it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { FavoriteButton } from "@/components/FavoriteButton";
import { RatingStars, RatingStarsView } from "@/components/RatingStars";
import { I18nProvider } from "@/i18n/I18nProvider";
import {
  playFavoriteFx,
  playRatingFx,
  resetFileFxForTest,
} from "@/lib/fileFxStore";

vi.mock("@/ipc/client", () => ({
  api: { fileSetFavorite: vi.fn().mockResolvedValue(undefined) },
  ALL_ID: "__all__",
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <I18nProvider>{children}</I18nProvider>
  </QueryClientProvider>
);

const a = { id: 1, workspaceId: "ws" };
const b = { id: 2, workspaceId: "ws" };

const heart = (file: { id: number }, favorite = 0) => (
  <FavoriteButton fileId={file.id} workspaceId="ws" favorite={favorite} />
);

beforeEach(() => {
  vi.useFakeTimers();
  resetFileFxForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("favorite effects from outside", () => {
  it("plays on the named file's heart only", () => {
    const { container } = render(
      <>
        <div data-testid="a">{heart(a)}</div>
        <div data-testid="b">{heart(b)}</div>
      </>,
      { wrapper },
    );
    act(() => playFavoriteFx([{ ...a, favorite: 0 }], true));

    const [first, second] = container.querySelectorAll("button");
    expect(first.querySelector(".fx-pop")).not.toBeNull();
    expect(first.querySelector('[data-testid="fx-burst"]')).not.toBeNull();
    expect(second.querySelector(".fx-pop")).toBeNull();
  });

  it("settles on a remove", () => {
    const { container } = render(heart(a, 1), { wrapper });
    act(() => playFavoriteFx([{ ...a, favorite: 1 }], false));
    expect(container.querySelector(".fx-settle")).not.toBeNull();
    expect(container.querySelector('[data-testid="fx-burst"]')).toBeNull();
  });

  it("plays nothing for a value that changed without being asked to", () => {
    const { container, rerender } = render(heart(a, 0), { wrapper });
    rerender(heart(a, 1));
    expect(container.querySelector(".fx-pop")).toBeNull();
  });

  it("still plays on a heart mounted while the effect is live", () => {
    act(() => playFavoriteFx([{ ...a, favorite: 0 }], true));
    const { container } = render(heart(a, 1), { wrapper });
    expect(container.querySelector(".fx-pop")).not.toBeNull();
  });

  it("does not replay on a heart mounted after the effect is over", () => {
    act(() => playFavoriteFx([{ ...a, favorite: 0 }], true));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const { container } = render(heart(a, 1), { wrapper });
    expect(container.querySelector(".fx-pop")).toBeNull();
  });
});

describe("which effects play", () => {
  it("skips files the change leaves as they were", () => {
    const { container } = render(heart(a, 1), { wrapper });
    act(() => playFavoriteFx([{ ...a, favorite: 1 }], true));
    expect(container.querySelector(".fx-pop")).toBeNull();
  });

  it("does not replay on a control reused for another file", () => {
    act(() => playFavoriteFx([{ ...b, favorite: 0 }], true));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const { container, rerender } = render(heart(a), { wrapper });
    rerender(heart(b, 1));
    expect(container.querySelector(".fx-pop")).toBeNull();
  });

  it("keeps playing once its entry is gone, without falling back", () => {
    const { container } = render(heart(a), { wrapper });
    act(() => playFavoriteFx([{ ...a, favorite: 0 }], true));
    const pop = container.querySelector(".fx-pop");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // The same element: not remounted, so the animation is not restarted.
    expect(container.querySelector(".fx-pop")).toBe(pop);
  });
});

describe("rating effects from outside", () => {
  const stars = (rating: number) => <RatingStarsView value={rating} file={a} />;

  it("pops the stars up to the new rating, bursting on the last", () => {
    const { container } = render(stars(0), { wrapper });
    act(() => playRatingFx([{ ...a, rating: 0 }], 3));

    expect(container.querySelectorAll(".fx-pop")).toHaveLength(3);
    expect(container.querySelectorAll('[data-testid="fx-burst"]')).toHaveLength(
      1,
    );
  });

  it("settles the stars that were lit when clearing", () => {
    const { container } = render(stars(4), { wrapper });
    act(() => playRatingFx([{ ...a, rating: 4 }], 0));
    expect(container.querySelectorAll(".fx-settle")).toHaveLength(4);
  });

  it("plays nothing for the rating a file already has", () => {
    const { container } = render(stars(3), { wrapper });
    act(() => playRatingFx([{ ...a, rating: 3 }], 3));
    expect(container.querySelector(".fx-pop")).toBeNull();
  });

  it("is not played again when a card swaps its drawn stars for editable ones", () => {
    const { container, rerender } = render(stars(0), { wrapper });
    act(() => playRatingFx([{ ...a, rating: 0 }], 3));
    expect(container.querySelectorAll(".fx-pop")).toHaveLength(3);

    // The card is hovered while the effect is still live.
    rerender(<RatingStars value={3} file={a} onChange={() => {}} />);
    expect(container.querySelector(".fx-pop")).toBeNull();
  });

  it("goes back to plain drawn stars once the effect is over", () => {
    const { container } = render(stars(0), { wrapper });
    act(() => playRatingFx([{ ...a, rating: 0 }], 3));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.querySelector(".fx-pop")).toBeNull();
  });

  it("ignores another file's rating", () => {
    const { container } = render(stars(0), { wrapper });
    act(() => playRatingFx([{ ...b, rating: 0 }], 5));
    expect(container.querySelector(".fx-pop")).toBeNull();
  });
});
