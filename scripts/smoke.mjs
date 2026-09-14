import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(
  new URL("../packages/mcp/package.json", import.meta.url),
);
const { Client } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js"))
    .href
);
const { StdioClientTransport } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js"))
    .href
);
const entry = process.argv[2] ?? resolve("packages/mcp/dist/cli.js");
const packageVersion = JSON.parse(
  await readFile(resolve(entry, "../../package.json"), "utf8"),
).version;
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) => !key.startsWith("T212_") && value !== undefined,
  ),
);
for (const args of [
  ["--help"],
  ["-h"],
  ["serve", "--help"],
  ["doctor", "--help"],
  ["--version"],
]) {
  const help = spawnSync(process.execPath, [entry, ...args], {
    env,
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.equal(help.stdout, "");
  assert.ok(help.stderr.length > 0);
  if (args[0] === "--version") assert.equal(help.stderr.trim(), packageVersion);
}
for (const args of [
  ["unknown"],
  ["doctor", "extra"],
  ["--unknown"],
  ["serve", "--api-key=must-not-echo"],
]) {
  const rejected = spawnSync(process.execPath, [entry, ...args], {
    env,
    encoding: "utf8",
  });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, "");
  assert.doesNotMatch(rejected.stderr, /must-not-echo/);
}
const missing = spawnSync(process.execPath, [entry, "doctor"], {
  env,
  encoding: "utf8",
});
assert.equal(missing.status, 1);
assert.equal(missing.stdout, "");
assert.match(missing.stderr, /T212_API_KEY and T212_API_SECRET/);

for (const enabled of [false, true]) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: enabled ? [entry, "serve"] : [entry],
    stderr: "pipe",
    env: {
      ...env,
      T212_ENV: "demo",
      T212_API_KEY: "fixture-key",
      T212_API_SECRET: "fixture-secret",
      T212_ALLOW_TRADING: String(enabled),
    },
  });
  const client = new Client({ name: "stdio-smoke", version: "1.0.0" });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, packageVersion);
    const { tools } = await client.listTools();
    assert.equal(tools.length, enabled ? 12 : 10);
    assert.equal(
      tools.some((tool) => tool.name === "place_order"),
      enabled,
    );
    const rejected = await client.callTool({
      name: enabled ? "place_order" : "get_history",
      arguments: {},
    });
    assert.equal(rejected.isError, true);
  } finally {
    await client.close();
  }
}
console.log(
  "Built stdio server: initialization, discovery, invalid-input rejection, and configuration failures passed. No broker calls made.",
);
