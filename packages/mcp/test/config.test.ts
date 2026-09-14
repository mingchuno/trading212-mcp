import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("configuration", () => {
  it("defaults to live with trading disabled", async () => {
    await expect(
      loadConfig({ T212_API_KEY: "key", T212_API_SECRET: "secret" }),
    ).resolves.toMatchObject({ environment: "live", allowTrading: false });
  });
  it("rejects ambiguous booleans and environments", async () => {
    await expect(
      loadConfig({
        T212_API_KEY: "key",
        T212_API_SECRET: "secret",
        T212_ALLOW_TRADING: "yes",
      }),
    ).rejects.toThrow();
    await expect(
      loadConfig({
        T212_API_KEY: "key",
        T212_API_SECRET: "secret",
        T212_ENV: "production",
      }),
    ).rejects.toThrow();
  });
  it("does not include credential values in configuration errors", async () => {
    await expect(loadConfig({ T212_API_KEY: "private-key" })).rejects.toThrow(
      "T212_API_KEY and T212_API_SECRET",
    );
  });
});
