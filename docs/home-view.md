# Home View

The Home view is the screen shown while the virtual `Home` workspace is active
(see [Architecture](architecture.md#the-virtual-home-view)). It shows shelves
of files drawn from every workspace in place of the library list.

The screen's arrangement is a **layout**. Layouts can be swapped: the
`homeLayout` preference picks one, and Settings offers the choice once more
than one exists. This document explains how the pieces fit together and how to
add a layout.

## Pieces

Everything lives under `src/routes/Home/`.

| File                     | Role                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `HomeShelves.tsx`        | Reads the `homeLayout` preference and renders that layout. Holds no layout of its own.            |
| `layouts/ids.ts`         | The layout ids, the default, and `isHomeLayoutId`. The preferences layer imports only this file.  |
| `layouts/types.ts`       | `HomeLayoutProps`: the shelves' data and the actions the route offers.                            |
| `layouts/index.ts`       | The registry `HOME_LAYOUTS` (id, Settings label key, component) and `homeLayoutFor`.              |
| `layouts/*Layout.tsx`    | One file per layout. `TodayPickLayout.tsx` is the current one.                                    |
| `shelfParts.tsx`         | Shared building blocks: `HeroCard`, `ShelfCard`, `ShelfRow`, `RowHeader`, `RowAction`, skeletons. |
| `useHomeShelves.ts`      | The shelves' queries (`recent`, `picks`, `played`) as `ShelfData`.                                |
| `useGridFit.ts`          | Card counts from the layout: `useSideFit` (beside a stage) and `useSingleRow` (one row).          |
| `useShelfKeyboardNav.ts` | Keyboard focus over rows of cards, with the list views' per-preset bindings.                      |
| `useHomeSplit.ts`        | The draggable split between two columns, remembered across sessions.                              |
| `index.tsx`              | The route: fetches the shelves, owns navigation, and renders `HomeShelves` while Home is active.  |

## Rules a layout follows

A layout only **arranges**. It must keep to these rules so layouts stay
interchangeable:

- **Take `HomeLayoutProps` and nothing else.** A layout never fetches data and
  never navigates. Actions such as "See all" arrive as callbacks from the route.
- **Build from `shelfParts.tsx`.** Use the shared cards, rows and headers, and
  do not restyle them inside a layout. A change to how a card looks belongs in
  `shelfParts.tsx`, where every layout picks it up.
- **Own the keyboard order.** Build the rows of files in the order they appear
  on screen, pass their sizes to `useShelfKeyboardNav`, and give the focused
  card the ring and the Watch Later ref. The order must match exactly what is
  rendered, so cut the files (with `useSideFit` or `useSingleRow`) before
  building it.
- **Handle every state.** Each `ShelfData` can be loading (`loaded` false),
  empty, failed with no rows, or failed with the previous rows kept. `ShelfRow`
  covers these for a row of cards. Anything custom, such as a stage, must cover
  them too, and must keep the reshuffle button reachable when there is no pick.
- **Scroll in the app's `ScrollArea`**, not a native scrollbar.

## Adding a layout

The steps below add a layout called `compact` as an example.

1. **Add the id** to `HOME_LAYOUT_IDS` in `layouts/ids.ts`.

   ```ts
   export const HOME_LAYOUT_IDS = ["today-pick", "compact"] as const;
   ```

2. **Write the component** in `layouts/CompactLayout.tsx`. It takes
   `HomeLayoutProps` and is memoized, because the route re-renders on every
   thumbnail flush.

   ```tsx
   import { memo } from "react";
   import type { HomeLayoutProps } from "./types";

   export const CompactLayout = memo(function CompactLayout(
     props: HomeLayoutProps,
   ) {
     // Arrange shelfParts pieces; wire useShelfKeyboardNav over what is shown.
   });
   ```

   `TodayPickLayout.tsx` is the reference for the details: the `rows` list, the
   keyboard order, the Watch Later hotkey, and scrolling the focused card into
   view.

3. **Add a label key** for Settings, such as `home.layoutCompact`, to
   `src/i18n/locales/ja.ts` (the key type is defined there). Then add the same
   key to every other locale: `en`, `es`, `fr`, `ko` and `zh-CN`.

4. **Register the layout** in `HOME_LAYOUTS` in `layouts/index.ts`.

   ```ts
   {
     id: "compact",
     labelKey: "home.layoutCompact",
     Component: CompactLayout,
   },
   ```

5. **Check it.** `src/routes/Home/__tests__/layouts.test.ts` fails if an id is
   missing from the registry or a label key has no text. Add view tests for the
   new layout alongside `HomeShelves.test.tsx`, then run `npm run typecheck` and
   `npm test`.

With two layouts registered, the "Home layout" picker appears in Settings,
under General, without further changes. A stored id that is no longer
registered falls back to the default.

## Adding a shelf

A new kind of shelf, such as "Continue watching", is data rather than a
layout, so every layout can use it:

1. Add a query to `useHomeShelves.ts` and return it as another `ShelfData`.
2. Add its cache key to `src/lib/queryCache.ts` and to `HOME_SHELF_KEYS` there,
   so that the favorite, rating and removal patches reach its rows. Then decide
   which events invalidate it, and invalidate from those helpers.
3. Add it to `HomeLayoutProps` and pass it from the route in `index.tsx`.
4. In each layout that shows it, add a `useSingleRow` (or another fit) and one
   entry in the layout's `rows` list.
