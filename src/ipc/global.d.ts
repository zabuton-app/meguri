// Type of window.api exposed by the preload.
export {};

declare global {
  interface Window {
    api: {
      invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
      on(channel: string, cb: (payload: unknown) => void): () => void;
      setZoomFactor(factor: number): void;
      getZoomFactor(): number;
    };
  }
}
