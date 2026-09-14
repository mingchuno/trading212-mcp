import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { packages, packPackage } from "./release-packages.mjs";

const temporary = await mkdtemp(join(tmpdir(), "trading212-pack-"));
try {
  const artifacts = [];
  for (const pkg of packages)
    artifacts.push(await packPackage(pkg.path, temporary));
  const license = await readFile("LICENCE", "utf8");
  for (const artifact of artifacts) {
    const manifest = JSON.parse(
      execFileSync("tar", ["-xOf", artifact.tarball, "package/package.json"], {
        encoding: "utf8",
      }),
    );
    assert.equal(manifest.license, "MIT");
    assert.equal(
      execFileSync("tar", ["-xOf", artifact.tarball, "package/LICENCE"], {
        encoding: "utf8",
      }),
      license,
    );
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
      ...artifacts.map((artifact) => artifact.tarball),
    ],
    { cwd: consumer, stdio: "pipe" },
  );
  const imported = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import { Trading212Client } from '@mingchuno/trading212-client'; import { getAccountSummary } from '@mingchuno/trading212-client/generated'; import { createTrading212Server } from '@mingchuno/trading212-mcp'; if (![Trading212Client, getAccountSummary, createTrading212Server].every(value => typeof value === 'function')) process.exit(1); console.log('ok');",
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  assert.equal(imported.trim(), "ok");
  execFileSync(
    process.execPath,
    [
      resolve("scripts/smoke.mjs"),
      join(consumer, "node_modules/@mingchuno/trading212-mcp/dist/cli.js"),
    ],
    { stdio: "inherit" },
  );
  console.log(
    "Both npm tarballs installed and ran outside the workspace. Nothing published.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
