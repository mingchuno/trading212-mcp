import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

async function contents(directory) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const result = {};
  for (const file of files)
    result[relative(directory, file)] = await readFile(file, "utf8");
  return result;
}
const temporary = await mkdtemp(join(tmpdir(), "trading212-generation-"));
try {
  const normalized = join(temporary, "normalized.json");
  const generated = join(temporary, "generated");
  const env = {
    ...process.env,
    T212_NORMALIZED_SPEC: normalized,
    T212_GENERATED_DIR: generated,
  };
  execFileSync(process.execPath, ["scripts/normalize-spec.mjs"], {
    env,
    stdio: "inherit",
  });
  execFileSync("pnpm", ["exec", "openapi-ts"], { env, stdio: "inherit" });
  const specMatches =
    (await readFile(normalized, "utf8")) ===
    (await readFile("openapi/trading212.normalized.json", "utf8"));
  const outputMatches =
    JSON.stringify(await contents(generated)) ===
    JSON.stringify(await contents(resolve("packages/client/src/generated")));
  if (!specMatches || !outputMatches)
    throw new Error(
      "Generated files are stale. Run pnpm generate and review the changes.",
    );
  console.log("Generated client and normalized specification match.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
