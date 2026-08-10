// Prevent FOUC: apply data-theme from the localStorage mirror before the first paint.
// The source of truth is SQLite settings, but LS is used as a mirror for the brief moment right after startup.
(function () {
  // Keep in sync with DEFAULT_THEME in src/themes/schemes.ts and its base00.
  var DEFAULT_THEME = "gruvbox-dark";
  var DEFAULT_BG = "#282828";
  try {
    document.documentElement.setAttribute(
      "data-theme",
      localStorage.getItem("meguri.theme") || DEFAULT_THEME,
    );
    // The palettes live in the bundle, which has not been evaluated yet, so the variables the
    // stylesheet refers to do not resolve on the very first paint. ThemeProvider mirrors the
    // active background here so that moment shows the theme's own color instead of white.
    document.documentElement.style.backgroundColor =
      localStorage.getItem("meguri.theme.bg") || DEFAULT_BG;
  } catch {
    document.documentElement.setAttribute("data-theme", DEFAULT_THEME);
    document.documentElement.style.backgroundColor = DEFAULT_BG;
  }
})();
