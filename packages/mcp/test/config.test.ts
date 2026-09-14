import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

it("loads an owner-only credentials file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "t212-config-"));
  try {
    const path = join(directory, "credentials.json");
    await writeFile(
      path,
      JSON.stringify({ apiKey: "file-key", apiSecret: "file-secret" }),
      { mode: 0o600 },
    );
    await expect(
      loadConfig({
        T212_CREDENTIALS_FILE: path,
        T212_ENV: "demo",
        T212_ALLOW_TRADING: "true",
      }),
    ).resolves.toEqual({
      apiKey: "file-key",
      apiSecret: "file-secret",
      environment: "demo",
      allowTrading: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects conflicting credential sources before reading the file", async () => {
  await expect(
    loadConfig({
      T212_CREDENTIALS_FILE: "/nonexistent/credentials.json",
      T212_API_KEY: "private-key",
    }),
  ).rejects.toThrow(
    "Use either T212_CREDENTIALS_FILE or the API key/secret environment variables, not both.",
  );
});
it("preserves configuration validation order", async () => {
  await expect(
    loadConfig({
      T212_ENV: "invalid",
      T212_ALLOW_TRADING: "invalid",
      T212_CREDENTIALS_FILE: "/nonexistent",
      T212_API_KEY: "key",
    }),
  ).rejects.toThrow("T212_ENV must be live or demo.");
  await expect(
    loadConfig({
      T212_ALLOW_TRADING: "invalid",
      T212_CREDENTIALS_FILE: "/nonexistent",
      T212_API_KEY: "key",
    }),
  ).rejects.toThrow("T212_ALLOW_TRADING must be true or false.");
});
