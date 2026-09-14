import { readFile } from "node:fs/promises";
import { Manifest, setLogger } from "release-please";
import { parseConventionalCommits } from "release-please/build/src/commit.js";
import { buildStrategy } from "release-please/build/src/factory.js";
import { TagName } from "release-please/build/src/util/tag-name.js";
import { Version } from "release-please/build/src/version.js";
import { describe, expect, it } from "vitest";

setLogger({ info() {}, warn() {}, error() {}, debug() {} });
const config = JSON.parse(await readFile("release-please-config.json", "utf8"));
const paths = ["packages/client", "packages/mcp"];
const manifests = Object.fromEntries(
  await Promise.all(
    paths.map(async (path) => [
      path,
      {
        ...JSON.parse(await readFile(`${path}/package.json`, "utf8")),
        version: "0.1.0",
      },
    ]),
  ),
);

async function propose(changes, firstRelease = false) {
  const github = {
    repository: {
      owner: "mingchuno",
      repo: "trading212-mcp",
      defaultBranch: "main",
    },
    getFileJson: async (path) =>
      path === "release-please-config.json" ? config : {},
    getFileContentsOnBranch: async (path) => {
      const pkg = manifests[path.replace(/\/package.json$/, "")];
      if (!pkg) throw new Error(`Unexpected fixture read: ${path}`);
      const parsedContent = JSON.stringify(pkg, null, 2);
      return {
        parsedContent,
        content: Buffer.from(parsedContent).toString("base64"),
        sha: "a".repeat(40),
      };
    },
  };
  const manifest = await Manifest.fromManifest(github, "main");
  const strategies = {};
  const releases = {};
  for (const path of paths) {
    strategies[path] = await buildStrategy({
      ...manifest.repositoryConfig[path],
      github,
      path,
      targetBranch: "main",
    });
    if (!firstRelease)
      releases[path] = {
        tag: new TagName(
          Version.parse("0.1.0"),
          config.packages[path].component,
        ),
        sha: "a".repeat(40),
        notes: "",
      };
  }
  const commits = Object.fromEntries(
    paths.map((path) => [
      path,
      changes[path]
        ? [
            {
              sha: "b".repeat(40),
              message: changes[path],
              files: [`${path}/src/index.ts`],
            },
          ]
        : [],
    ]),
  );
  for (const plugin of manifest.plugins)
    await plugin.preconfigure(strategies, commits, releases);
  let candidates = [];
  for (const path of paths) {
    const pullRequest = await strategies[path].buildReleasePullRequest(
      parseConventionalCommits(commits[path]),
      releases[path],
    );
    if (pullRequest)
      candidates.push({
        path,
        pullRequest,
        config: manifest.repositoryConfig[path],
      });
  }
  for (const plugin of manifest.plugins)
    candidates = await plugin.run(candidates);
  const updated = {};
  for (const candidate of candidates)
    for (const update of candidate.pullRequest.updates) {
      if (!update.path.endsWith("/package.json")) continue;
      const path = update.path.replace(/\/package.json$/, "");
      if (manifests[path])
        updated[path] = JSON.parse(
          update.updater.updateContent(
            JSON.stringify(manifests[path], null, 2),
          ),
        );
    }
  return { candidates, updated };
}

describe("pinned release-please workspace policy", () => {
  it("patches only MCP for an MCP fix", async () => {
    const { updated } = await propose({
      "packages/mcp": "fix(mcp): handle disconnected clients",
    });
    expect(updated["packages/mcp"].version).toBe("0.1.1");
    expect(updated["packages/client"]).toBeUndefined();
  });
  it("bumps the client for a feature and patch-bumps its dependent in one PR", async () => {
    const { candidates, updated } = await propose({
      "packages/client": "feat(client): add report filtering",
    });
    expect(candidates).toHaveLength(1);
    expect(updated["packages/client"].version).toBe("0.2.0");
    expect(updated["packages/mcp"].version).toBe("0.1.1");
    expect(
      updated["packages/mcp"].dependencies["@mingchuno/trading212-client"],
    ).toBe("workspace:^");
    expect(candidates[0].pullRequest.body.toString()).toContain(
      "report filtering",
    );
  });
  it("keeps breaking changes before 1.0 on the minor line", async () => {
    const { updated } = await propose({
      "packages/client":
        "feat(client)!: replace order arguments\n\nBREAKING CHANGE: use explicit order objects",
    });
    expect(updated["packages/client"].version).toBe("0.2.0");
    expect(updated["packages/mcp"].version).toBe("0.1.1");
  });
  it("bootstraps both unpublished packages at 0.1.0", async () => {
    const { updated } = await propose(
      {
        "packages/client": "feat: initial client",
        "packages/mcp": "feat: initial MCP",
      },
      true,
    );
    expect(updated["packages/client"].version).toBe("0.1.0");
    expect(updated["packages/mcp"].version).toBe("0.1.0");
  });
});
