import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";
import { builtinModules } from "node:module";

// Modules only the main process can load: Electron's main-process API, the
// native SQLite binding, the bundled ffmpeg/ffprobe binaries and the main-side
// logger (the renderer uses electron-log/renderer).
const MAIN_ONLY_MODULES = [
  "electron",
  "better-sqlite3",
  "@zabuton-app/ffmpeg-binaries",
  "electron-log/main",
];
// Bare names (fs, path, fs/promises, ...); node:-prefixed ones are matched by
// a pattern below. The list follows the Node version running ESLint.
const NODE_BUILTINS = builtinModules.filter((m) => !m.startsWith("node:"));

// no-restricted-imports options that keep code out of the main process: its
// folder, main-only packages (and their subpaths) and, unless allowNode is set,
// Node built-ins, plus any extra patterns in `also`. Only static imports and
// re-exports are checked; a dynamic import() is not.
function mainProcessOff(message, { allowNode = false, also = [] } = {}) {
  const mainOnly = [
    ...MAIN_ONLY_MODULES.flatMap((m) => [m, `${m}/**`]),
    "**/electron/**",
    ...also,
  ];
  return {
    paths: allowNode ? [] : NODE_BUILTINS.map((name) => ({ name, message })),
    patterns: [
      { group: allowNode ? mainOnly : ["node:*", ...mainOnly], message },
    ],
  };
}
const RENDERER_MESSAGE =
  "The renderer reaches the main process only through window.api (preload) and the typed IPC in shared/ipc/. See docs/architecture.md#process-model.";
const SHARED_MESSAGE =
  "shared/ is bundled into both the main process and the renderer, so it must not import from src/, electron/, Node built-ins or main-only packages.";

export default tseslint.config(
  // Build artifacts and generated output are out of scope, and assembly/ is
  // AssemblyScript (compiled by scripts/build-wasm.mjs), not TypeScript.
  // .claude/ holds local agent worktrees: whole other checkouts.
  {
    ignores: [
      "out/**",
      "release/**",
      "dist/**",
      "node_modules/**",
      "assembly/**",
      ".claude/**",
    ],
  },

  // Base (shared across all TS/TSX)
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Pick up root-level config TS files not included by any tsconfig.
          // e2e/**/*.ts is covered by e2e/tsconfig.json, which projectService
          // discovers on its own (allowDefaultProject rejects '**' globs).
          allowDefaultProject: [
            "electron.vite.config.ts",
            "electron.vite.shared.ts",
            "vitest.config.ts",
            "vitest.setup.ts",
            "playwright.config.ts",
            "scripts/electron-launch.d.cts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Renderer (React, browser environment)
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // An overlay covering the window starts below the custom title bar, so
      // the window can still be moved and closed while it is open (#578).
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/\\bfixed inset-0\\b/]",
          message:
            "Use `fixed inset-below-title-bar` for a window-covering overlay (see docs/renderer.md#title-bar).",
        },
        {
          selector: "TemplateElement[value.raw=/\\bfixed inset-0\\b/]",
          message:
            "Use `fixed inset-below-title-bar` for a window-covering overlay (see docs/renderer.md#title-bar).",
        },
      ],
    },
  },

  // Tests: vi.mock factories forward to vi.fn mocks, whose results are `any`,
  // and `await act(async () => ...)` is how React flushes an update even when
  // the callback itself awaits nothing.
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },

  // Main process / preload / shared (Node environment)
  {
    files: ["electron/**/*.ts", "shared/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Process boundaries: the renderer reaches the main process only through
  // preload (window.api) and the typed IPC in shared/ipc/, and shared/ stays
  // importable from both sides. See docs/architecture.md#process-model.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", mainProcessOff(RENDERER_MESSAGE)],
    },
  },
  // Renderer tests run under Node in Vitest, so a test may read fixtures from
  // disk; the main process is still off limits.
  {
    files: ["src/**/__tests__/**/*.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        mainProcessOff(RENDERER_MESSAGE, { allowNode: true }),
      ],
    },
  },
  {
    files: ["shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        mainProcessOff(SHARED_MESSAGE, { also: ["@/**", "**/src/**"] }),
      ],
    },
  },
  {
    files: ["electron/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/**", "**/src/**"],
              message:
                "The main process must not import renderer code from src/. Move what both sides need to shared/.",
            },
          ],
        },
      ],
    },
  },

  // Playwright E2E (Node environment)
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Playwright fixtures with no dependencies use `async ({}, use)`
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }],
    },
  },

  // Plain JS scripts (linted without type information)
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        // No type info; disable projectService to avoid parse errors
        projectService: false,
        project: false,
      },
    },
  },

  // CommonJS scripts load their dependencies with require()
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // shadcn-style UI primitives co-locate variants etc. alongside components,
  // so disable the Fast Refresh warning about non-component exports

  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Context providers necessarily co-locate their hook (useTheme, usePreferences,
  // etc.) and a few constants next to the Provider component. That's a non-component
  // export, but Fast Refresh is dev-only and never affects production builds, so
  // disable the warning for these files rather than splitting every provider in two.
  {
    files: [
      "src/i18n/I18nProvider.tsx",
      "src/settings/PreferencesProvider.tsx",
      "src/themes/ThemeProvider.tsx",
      "src/components/ConfirmDialog.tsx",
      "src/components/SelectionContext.tsx",
      "src/tour/TourProvider.tsx",
    ],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Plain JS loaded directly by the browser (no type info, browser environment)
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // The pet preview page is plain JS served to the browser by Vite
  {
    files: ["tools/pet-preview/**/*.mjs"],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // Disable formatting rules that conflict with Prettier (must come last)
  prettier,
);
