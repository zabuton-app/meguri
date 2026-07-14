import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  // Build artifacts and generated output are out of scope
  {
    ignores: ["out/**", "release/**", "dist/**", "node_modules/**"],
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
            "vitest.config.ts",
            "vitest.setup.ts",
            "playwright.config.ts",
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
    },
  },

  // Main process / preload / shared (Node environment)
  {
    files: ["electron/**/*.ts", "shared/**/*.ts"],
    languageOptions: {
      globals: globals.node,
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

  // Disable formatting rules that conflict with Prettier (must come last)
  prettier,
);
