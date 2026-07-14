// Prevent FOUC: apply data-theme from the localStorage mirror before the first paint.
// The source of truth is SQLite settings, but LS is used as a mirror for the brief moment right after startup.
(function () {
  try {
    var t = localStorage.getItem("meguri.theme") || "gruvbox-dark";
    document.documentElement.setAttribute("data-theme", t);
  } catch {
    document.documentElement.setAttribute("data-theme", "gruvbox-dark");
  }
})();
