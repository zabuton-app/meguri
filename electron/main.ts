// Meguri's entry point. The app itself starts in startApp() (electron/app.ts).
import { startApp } from "./app.js";

startApp({
  name: "Meguri",
  glyph: "巡",
  urlScheme: "meguri",
  updateRepo: { owner: "zabuton-app", name: "meguri" },
  msStoreProductId: "9NRSM11RRH8Z",
});
