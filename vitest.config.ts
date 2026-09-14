import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "scripts/test/**/*.test.mjs"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/client/src/generated/**"],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
      // Reports reveal blind spots; behavioral tests are the acceptance gate.
    },
  },
  resolve: {
    alias: {
      "@mingchuno/trading212-client": new URL(
        "./packages/client/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
