import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporary = await mkdtemp(join(tmpdir(), "trading212-pack-"));
try {
  for (const name of ["client", "mcp"]) {
    execFileSync("pnpm", ["pack", "--pack-destination", temporary], {
      cwd: resolve("packages", name),
      stdio: "pipe",
    });
  }
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(temporary, "trading212-local-client-0.1.0.tgz"),
      join(temporary, "trading212-local-mcp-0.1.0.tgz"),
    ],
    { cwd: consumer, stdio: "pipe" },
  );
  const imported = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import { Trading212Client } from '@trading212-local/client'; import { getAccountSummary } from '@trading212-local/client/generated'; import { createTrading212Server } from '@trading212-local/mcp'; if (![Trading212Client, getAccountSummary, createTrading212Server].every(value => typeof value === 'function')) process.exit(1); console.log('ok');",
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  assert.equal(imported.trim(), "ok");
  execFileSync(
    process.execPath,
    [
      resolve("scripts/smoke.mjs"),
      join(consumer, "node_modules/@trading212-local/mcp/dist/cli.js"),
    ],
    { stdio: "inherit" },
  );
  console.log(
    "Both npm tarballs installed and ran outside the workspace. Nothing published.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
