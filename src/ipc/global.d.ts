// Type of window.api exposed by the preload.
export {};

declare global {
  interface Window {
    api: {
      /** The app's name, as passed to startApp() in the main process. */
      appName: string;
      /** The app's one-character mark, from the same options. */
      appGlyph: string;
      invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
      on(channel: string, cb: (payload: unknown) => void): () => void;
      setZoomFactor(factor: number): void;
      getZoomFactor(): number;
      addDroppedWorkspace(file: File): Promise<unknown>;
    };
  }
}
