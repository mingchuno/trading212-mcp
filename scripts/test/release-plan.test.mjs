import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sha = "a".repeat(40);
const client = {
  path: "packages/client",
  version: "0.2.0",
  tagName: "client-v0.2.0",
  sha,
};
const mcp = {
  path: "packages/mcp",
  version: "0.1.1",
  tagName: "mcp-v0.1.1",
  sha,
};

function actionOutputs(releases) {
  return {
    paths_released: JSON.stringify(releases.map(({ path }) => path)),
    ...Object.fromEntries(
      releases.flatMap(({ path, version, tagName, sha }) => [
        [`${path}--version`, version],
        [`${path}--tag_name`, tagName],
        [`${path}--sha`, sha],
      ]),
    ),
  };
}

async function runPlan(outputs) {
  const directory = await mkdtemp(join(tmpdir(), "release-plan-"));
  const output = join(directory, "output");
  try {
    await writeFile(output, "");
    const result = spawnSync(process.execPath, ["scripts/release-plan.mjs"], {
      env: {
        ...process.env,
        RELEASE_OUTPUTS: JSON.stringify(outputs),
        GITHUB_OUTPUT: output,
      },
      encoding: "utf8",
    });
    return { status: result.status, output: await readFile(output, "utf8") };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("release action publication plan", () => {
  it.each([
    { name: "no releases", releases: [] },
    { name: "client only", releases: [client] },
    { name: "MCP only", releases: [mcp] },
    { name: "both packages", releases: [mcp, client] },
  ])(
    "exports only released packages in publication order: $name",
    async ({ releases }) => {
      const expected = [client, mcp].filter((pkg) => releases.includes(pkg));
      const plan = { sha: expected.length ? sha : null, packages: expected };
      expect(await runPlan(actionOutputs(releases))).toEqual({
        status: 0,
        output: `plan=${JSON.stringify(plan)}\nsha=${plan.sha ?? ""}\nreleased=${expected.length > 0}\n`,
      });
    },
  );

  it.each([
    {},
    { paths_released: "null" },
    { paths_released: "invalid JSON" },
    { paths_released: '["packages/client"]' },
    actionOutputs([{ ...client, path: "." }]),
    actionOutputs([client, client]),
    actionOutputs([{ ...client, tagName: "main" }]),
    actionOutputs([{ ...client, version: "0.2.0\nreleased=true" }]),
    actionOutputs([client, { ...mcp, sha: "b".repeat(40) }]),
  ])(
    "rejects invalid outputs without exporting a plan: %j",
    async (outputs) => {
      const result = await runPlan(outputs);
      expect(result.status).not.toBe(0);
      expect(result.output).toBe("");
    },
  );
});
