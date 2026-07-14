// Top-level React error boundary. Forwards rendering errors to electron-log so
// they reach the main log file even when the UI has already torn down, then
// shows a minimal fallback. Intentionally hardcoded English: the i18n layer may
// itself be the thing that crashed.
import { Component, type ErrorInfo, type ReactNode } from "react";
import log from "@/lib/logger";

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
    return (
      <div
        style={{
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          color: "#eee",
          background: "#222",
          minHeight: "100vh",
        }}
      >
        <h1 style={{ fontSize: 18, marginBottom: 12 }}>
          Something went wrong.
        </h1>
        <p style={{ marginBottom: 16, opacity: 0.8 }}>
          The error has been logged. You can try reloading the window.
        </p>
        <button
          type="button"
          onClick={() => location.reload()}
          style={{
            padding: "6px 12px",
            background: "#444",
            color: "#fff",
            border: "1px solid #666",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
