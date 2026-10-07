import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/node_modules/**",
    "**/vendor/**",
    ".venv/**",
    "supabase/**",
    "dist/**",
    "**/coverage/**",
    ".reports/**",
  ]),
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      "agent-mail/**/*.ts",
      "project-spec/**/*.ts",
      "memory-stone/**/*.ts",
      "task-delegation/**/*.ts",
      "worker-daemon/**/*.ts",
      "bots/**/.pi/extensions/**/*.ts",
    ],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  prettier,
);
