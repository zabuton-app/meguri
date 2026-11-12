// Meguri's entry point. The app itself starts in startApp() (electron/app.ts).
import { startApp } from "./app.js";

startApp({
  name: "Meguri",
  urlScheme: "meguri",
  updateRepo: { owner: "zabuton-app", name: "meguri" },
});
