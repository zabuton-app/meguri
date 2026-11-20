// Top-level React error boundary. Forwards rendering errors to electron-log so
// they reach the main log file even when the UI has already torn down, then
// shows a minimal fallback. Intentionally hardcoded English: the i18n layer may
// itself be the thing that crashed.
import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { api } from "@/ipc/client";
import log from "@/lib/logger";
import { platform } from "@/lib/platform";
import { TITLE_BAR_HEIGHT } from "@shared/titleBar";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error("ErrorBoundary caught:", error, info.componentStack);
  }

  reset = (): void => this.setState({ hasError: false });

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    // Inline styles (Tailwind classes could themselves be what failed), but still the theme
    // variables: hardcoded dark colors would blind-side anyone on a light theme.
    return (
      <div
        style={{
          fontFamily: "system-ui, sans-serif",
          color: "var(--c-fg)",
          background: "var(--c-bg)",
          minHeight: "100vh",
          // Inline rather than the `select-text` class, for the same reason as
          // the colors above: Tailwind may be what failed. Selection is opt-in
          // app-wide (see styles.css), and a crash screen has to stay copyable.
          WebkitUserSelect: "text",
          userSelect: "text",
        }}
      >
        <FallbackTitleBar />
        <div style={{ padding: 24 }}>
          <h1 style={{ fontSize: 18, marginBottom: 12 }}>
            Something went wrong.
          </h1>
          <p style={{ marginBottom: 16, color: "var(--c-muted)" }}>
            The error has been logged. You can try reloading the window.
          </p>
          <button
            type="button"
            onClick={() => location.reload()}
            style={buttonStyle}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

const buttonStyle: CSSProperties = {
  padding: "6px 12px",
  background: "var(--c-surface)",
  color: "var(--c-fg)",
  border: "1px solid var(--c-border-strong)",
  borderRadius: 4,
  cursor: "pointer",
};

/** -webkit-app-region, which React's style types do not know. */
function appRegion(value: "drag" | "no-drag"): CSSProperties {
  return { WebkitAppRegion: value } as CSSProperties;
}

/**
 * The window has no native title bar (TitleBar.tsx, which went down with the
 * rest), so the crash screen keeps a way to move it and, where the OS draws
 * no window buttons, to close it.
 */
function FallbackTitleBar() {
  return (
    <div
      style={{
        // The title bar's height: on macOS the traffic lights stay where it
        // last put them, at either end of this band.
        height: TITLE_BAR_HEIGHT,
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "0 8px",
        ...appRegion("drag"),
      }}
    >
      {platform() !== "darwin" && (
        <button
          type="button"
          onClick={() => void api.windowClose()}
          style={{
            ...buttonStyle,
            padding: "2px 10px",
            ...appRegion("no-drag"),
          }}
        >
          Close
        </button>
      )}
    </div>
  );
}
