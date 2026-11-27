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
    var bg = localStorage.getItem("meguri.theme.bg") || DEFAULT_BG;
    if (randomThemeOnStartup()) {
      // The renderer is about to pick another theme, so the previous theme's color would only
      // flash. Paint a neutral gray of the same lightness instead and let the new theme fade in.
      bg = isLight(bg) ? "#f4f4f4" : "#1c1c1c";
      document.documentElement.setAttribute("data-boot-fade", "");
    }
    document.documentElement.style.backgroundColor = bg;
  } catch {
    document.documentElement.setAttribute("data-theme", DEFAULT_THEME);
    document.documentElement.style.backgroundColor = DEFAULT_BG;
  }

  // Reads the preference PreferencesProvider stores (keep the key and field in sync). A
  // broken value only turns the fade off; it must not discard the stored theme above.
  function randomThemeOnStartup() {
    try {
      var prefs = JSON.parse(localStorage.getItem("meguri.prefs") || "{}");
      return !!prefs && prefs.randomThemeOnStartup === true;
    } catch {
      return false;
    }
  }

  function isLight(hex) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return false;
    var r = parseInt(m[1], 16);
    var g = parseInt(m[2], 16);
    var b = parseInt(m[3], 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 128;
  }
})();
