import { appendFile } from "node:fs/promises";
import { GitHub, Manifest } from "release-please";
import { releasePlan } from "./release-packages.mjs";

if (
  process.env.GITHUB_REPOSITORY !== "mingchuno/trading212-mcp" ||
  process.env.GITHUB_REF !== "refs/heads/main" ||
  !process.env.RELEASE_TOKEN ||
  !process.env.GITHUB_OUTPUT
) {
  throw new Error(
    "Release automation must run on the upstream main branch with a GitHub App token.",
  );
}
const github = await GitHub.create({
  owner: "mingchuno",
  repo: "trading212-mcp",
  defaultBranch: "main",
  token: process.env.RELEASE_TOKEN,
});
const manifest = () => Manifest.fromManifest(github, "main");
const releases = (await (await manifest()).createReleases())
  .filter(Boolean)
  .map(({ path, version, tagName, sha }) => ({ path, version, tagName, sha }));
const plan = releasePlan(releases);
await appendFile(
  process.env.GITHUB_OUTPUT,
  `plan=${JSON.stringify(plan)}\nsha=${plan.sha ?? ""}\nreleased=${plan.packages.length > 0}\n`,
);
// Reload after tagging so the next PR starts after the releases just created.
await (await manifest()).createPullRequests();
