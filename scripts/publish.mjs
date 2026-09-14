import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  lookupPublished,
  packages,
  packPackage,
  publishPackages,
  releasePlan,
} from "./release-packages.mjs";

if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REPOSITORY !== "mingchuno/trading212-mcp" ||
  !process.env.ACTIONS_ID_TOKEN_REQUEST_URL
)
  throw new Error(
    "Publishing requires the upstream GitHub Actions OIDC environment.",
  );
const supplied = JSON.parse(process.env.RELEASE_PLAN ?? "{}");
const plan = releasePlan(supplied.packages);
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (!plan.sha || plan.sha !== supplied.sha || head !== plan.sha)
  throw new Error("Checkout must match the exact release commit.");
for (const release of plan.packages) {
  const tagged = execFileSync(
    "git",
    ["rev-parse", `${release.tagName}^{commit}`],
    { encoding: "utf8" },
  ).trim();
  if (tagged !== head)
    throw new Error(`Tag ${release.tagName} does not match checkout.`);
}
const directory = await mkdtemp(join(tmpdir(), "trading212-publish-"));
try {
  const artifacts = [];
  for (const release of plan.packages) {
    const artifact = await packPackage(release.path, directory);
    const expected = packages.find((pkg) => pkg.path === release.path);
    if (artifact.name !== expected.name || artifact.version !== release.version)
      throw new Error("Package manifest does not match release metadata.");
    artifacts.push(artifact);
  }
  await publishPackages(artifacts, {
    lookup: lookupPublished,
    publish: (tarball) =>
      execFileSync(
        process.execPath,
        [
          resolve("node_modules/npm/bin/npm-cli.js"),
          "publish",
          tarball,
          "--access",
          "public",
          "--tag",
          "latest",
          "--ignore-scripts",
        ],
        { stdio: "inherit" },
      ),
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
