// Swaps the canvas for a notice when WebGL is unavailable (sigma cannot get a
// context, or the context is lost). The rest of the app is unaffected.
import { Component, type ErrorInfo, type ReactNode } from "react";
import log from "@/lib/logger";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}

interface State {
  failed: boolean;
}

export class GraphErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error("graph view failed:", error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
