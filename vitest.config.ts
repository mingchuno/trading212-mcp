import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/*/test/**/*.test.ts"], testTimeout: 10000 },
  resolve: {
    alias: {
      "@mingchuno/trading212-client": new URL(
        "./packages/client/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
