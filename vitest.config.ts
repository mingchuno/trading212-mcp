import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/*/test/**/*.test.ts"], testTimeout: 10000 },
  resolve: {
    alias: {
      "@trading212-local/client": new URL(
        "./packages/client/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
