import { defineConfig } from "vitest/config";
import path from "node:path";

// Two-project setup so the existing 432-test node-env suite keeps working
// untouched while .test.tsx component tests (RTL surface) run in jsdom.
// Node-env tests must stay node-env: they exercise fileService / IndexedDB
// shim assertions that break under jsdom.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test-setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test-setup.ts",
        "src/__mocks__/**",
        "src/**/*.d.ts",
      ],
    },
  },
});
