// ============================================================================
// TSH Synergy AR — ESLint flat configuration (ESLint 9 + Next.js 15.5.19)
//
// Batch 9D-D (B9DD-FEIR-011): the repository previously had eslint and
// eslint-config-next as devDependencies but no configuration file, so
// `next lint` prompted interactively and could never produce a real PASS.
// This config is non-interactive and uses the already-present dependencies.
// Rule categories are NOT broadly disabled — see the narrow, justified
// exceptions below.
// ============================================================================

import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "supabase/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Allow intentionally-unused function args prefixed with "_" (an
      // established convention in this codebase). Everything else still errors.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Batch 9D-D: monetary correctness depends on exact typing. Keep the
      // `any` ban at error severity for the whole app.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Test files may assert on deliberately malformed/partial API contracts.
    files: ["**/*.test.ts", "**/*.test.tsx", "vitest.setup.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
