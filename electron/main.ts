// Meguri's entry point. The app itself starts in startApp() (electron/app.ts).
import { startApp } from "./app.js";
import { MEGURI_LOGOS } from "./core/logoAssets.js";

startApp({
  name: "Meguri",
  glyph: "巡",
  urlScheme: "meguri",
  updateRepo: { owner: "zabuton-app", name: "meguri" },
  msStoreProductId: "9NRSM11RRH8Z",
  envPrefix: "MEGURI",
  logos: MEGURI_LOGOS,
});
