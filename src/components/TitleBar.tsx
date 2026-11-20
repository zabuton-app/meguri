// The window's title bar, drawn by the app in place of the OS's (#578): a
// strip across the top that moves the window and holds the logo, the current
// screen's header (the slot, see titleBarSlot.tsx) and the window buttons. It
// shares its color with the workspace rail below it (App.tsx), so the two read
// as one frame around the content.
//
// The window buttons sit at the end the user picked, or nowhere (Settings >
// Appearance; the default follows the OS). Windows and Linux get the app's
// own buttons. macOS keeps its traffic lights, which the bar leaves room for
// and moves there (window_set_button_position): they do not zoom with the
// page, so the room is sized in screen px and they are placed again on every
// resize. "None" hides them (window_set_button_visibility).
//
// The logo heads the rail's column: here, above the rail, unless the buttons
// take the bar's left end; then it is the rail's first item (WorkspaceRail).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { api, events } from "@/ipc/client";
import type { WindowState } from "@shared/ipc/channels";
import { TRAFFIC_LIGHTS } from "@shared/titleBar";
import { useI18n } from "@/i18n/I18nProvider";
import { AppLogo } from "@/components/AppLogo";
import { platform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  usePreferences,
  type WindowButtons as Side,
} from "@/settings/PreferencesProvider";

/** What a click on the bar reaches instead of moving the window; styles.css
 *  makes the same elements no-drag. */
const CONTROLS =
  'a, button, input, select, textarea, [role="button"], [role="combobox"], [data-title-bar-control]';

/** The room the bar leaves macOS's traffic lights, in screen px. */
const LIGHTS_ROOM = 76;

function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({
    maximized: false,
    fullScreen: false,
  });
  useEffect(() => {
    // An event that lands before the first answer is newer than it.
    let heard = false;
    const off = events.onWindowState((s) => {
      heard = true;
      setState(s);
    });
    api
      .windowState()
      .then((s) => {
        if (!heard) setState(s);
      })
      .catch(() => {});
    return off;
  }, []);
  return state;
}

export function TitleBar({
  slotRef,
}: {
  /** Receives the element a screen's header is rendered into. */
  slotRef?: Ref<HTMLDivElement>;
}) {
  const { windowButtons: side } = usePreferences();
  const { maximized, fullScreen } = useWindowState();
  const mac = platform() === "darwin";

  // macOS gives the page the double click (Windows and Linux keep it: the bar
  // is the window's caption there). Not on a control: that is a click on it.
  // A DOM listener, not onDoubleClick: the header in the slot is a portal, so
  // React would hand its events to Home, not to the bar.
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    if (!mac || !bar) return;
    const onDoubleClick = (e: Event) => {
      if ((e.target as Element).closest(CONTROLS)) return;
      void api.windowTitleBarDoubleClick();
    };
    bar.addEventListener("dblclick", onDoubleClick);
    return () => bar.removeEventListener("dblclick", onDoubleClick);
  }, [mac]);

  // macOS draws the traffic lights itself: they come and go with the choice,
  // set again on leaving full screen, which shows them.
  useEffect(() => {
    if (mac) api.windowSetButtonVisibility(side !== "none").catch(() => {});
  }, [mac, side, fullScreen]);

  // Full screen hides the traffic lights, so their room goes too.
  const buttons =
    side === "none" ? null : mac ? (
      fullScreen ? null : (
        <TrafficLightsRoom side={side} />
      )
    ) : (
      <WindowButtons side={side} maximized={maximized} />
    );

  return (
    <div
      data-title-bar=""
      data-slot="title-bar"
      data-testid="title-bar"
      ref={barRef}
      className="flex h-(--meguri-title-bar-height) shrink-0 select-none items-stretch bg-chrome [-webkit-app-region:drag]"
    >
      {side === "left" ? (
        buttons
      ) : (
        <div className="flex w-16 shrink-0 items-center justify-center">
          <AppLogo className="size-7" />
        </div>
      )}
      <div
        ref={slotRef}
        data-title-bar-slot=""
        className={cn(
          // Clipped across, not down (the search box grows down over the
          // list): in a narrow window the header gives way, not the buttons.
          "flex min-w-0 flex-1 items-stretch overflow-x-clip",
          side === "left" && "pl-3",
        )}
      />
      {side === "right" && buttons}
    </div>
  );
}

/**
 * Room for macOS's traffic lights, which main draws over it. They keep their
 * screen size whatever the content zoom, so the room is divided by the zoom
 * (--meguri-zoom), and they are moved to its middle after every change that
 * can shift it.
 */
function TrafficLightsRoom({ side }: { side: Exclude<Side, "none"> }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      // The page's px times the zoom are the window's.
      const zoom = window.api?.getZoomFactor?.() ?? 1;
      const r = el.getBoundingClientRect();
      const x = r.left * zoom + (LIGHTS_ROOM - TRAFFIC_LIGHTS.width) / 2;
      const y = r.top * zoom + (r.height * zoom - TRAFFIC_LIGHTS.height) / 2;
      api
        .windowSetButtonPosition(
          Math.max(0, Math.round(x)),
          Math.max(0, Math.round(y)),
        )
        .catch(() => {});
    };
    place();
    // A resize (a zoom change fires one too) can move the room, and so can
    // the zoom's CSS variable changing its width without a resize (a reload
    // keeps the zoom; useContentZoom sets the variable after this runs).
    window.addEventListener("resize", place);
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    return () => {
      window.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [side]);
  return (
    <div
      ref={ref}
      data-testid="traffic-lights-room"
      className="shrink-0"
      style={{ width: `calc(${LIGHTS_ROOM}px / var(--meguri-zoom))` }}
    />
  );
}

/**
 * Windows and Linux: the app's own buttons, in the order each side is used
 * to: close first on the left (as macOS), close last on the right (as
 * Windows).
 */
function WindowButtons({
  side,
  maximized,
}: {
  side: Exclude<Side, "none">;
  maximized: boolean;
}) {
  const { t } = useI18n();
  const minimize = (
    <WindowButton
      key="minimize"
      label={t("window.minimize")}
      onClick={() => void api.windowMinimize()}
    >
      <Minus className="size-4" />
    </WindowButton>
  );
  const maximize = (
    <WindowButton
      key="maximize"
      label={maximized ? t("window.restore") : t("window.maximize")}
      onClick={() => void api.windowToggleMaximize()}
    >
      {maximized ? (
        <Copy className="size-3.5 -scale-x-100" />
      ) : (
        <Square className="size-3.5" />
      )}
    </WindowButton>
  );
  const close = (
    <WindowButton
      key="close"
      label={t("common.close")}
      onClick={() => void api.windowClose()}
      danger
    >
      <X className="size-4" />
    </WindowButton>
  );
  return (
    // pointer-events-auto: a Radix modal or menu sets pointer-events: none on
    // <body> to block the page behind it, which would take these too. The
    // header in the slot stays blocked, as the page is.
    <div className="pointer-events-auto flex shrink-0">
      {side === "left"
        ? [close, minimize, maximize]
        : [minimize, maximize, close]}
    </div>
  );
}

function WindowButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Not a tab stop: the OS's own buttons are not either, and the window
      // has keyboard ways to do the same (Esc hides it on the bare list).
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        "flex w-[46px] items-center justify-center text-muted transition-colors hover:text-fg",
        danger ? "hover:bg-error hover:text-bg" : "hover:bg-overlay",
      )}
    >
      {children}
    </button>
  );
}
