import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Allow underscore-prefixed names for intentionally unused args / catch
  // bindings / destructured locals. Standard convention.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // react-hooks v7 folds the React Compiler optimization rules into its
      // recommended set at error severity. These are advisory hints (the React
      // team ships them opt-in), not correctness guarantees, and fire on many
      // legitimate patterns. We run them as warnings so they stay visible for
      // opportunistic cleanup without blocking CI or forcing behavior-risky
      // rewrites of working code. rules-of-hooks (a true correctness rule)
      // stays at its default error severity.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/globals": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party code (recycled SeqViz + bio-parsers). We keep an
    // upstream-faithful copy so it can be re-synced; linting it to our house
    // rules produces hundreds of false positives and would fork it from source.
    "src/vendor/**",
    // Generated / minified static worker bundles served from public/. These are
    // build artifacts (duckdb-wasm, rdkit, hmmer, pdf.js workers), not source.
    "public/**",
  ]),
]);

export default eslintConfig;
