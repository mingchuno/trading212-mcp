import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input:
    process.env.T212_NORMALIZED_SPEC ?? "./openapi/trading212.normalized.json",
  output: {
    path: process.env.T212_GENERATED_DIR ?? "packages/client/src/generated",
  },
  plugins: ["@hey-api/typescript", "@hey-api/sdk", "@hey-api/client-fetch"],
});
