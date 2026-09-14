import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const packages = [
  {
    path: "packages/client",
    name: "@mingchuno/trading212-client",
    component: "client",
  },
  { path: "packages/mcp", name: "@mingchuno/trading212-mcp", component: "mcp" },
];

export function releasePlan(releases) {
  if (!Array.isArray(releases)) throw new Error("Expected a release list.");
  const seen = new Set();
  for (const release of releases) {
    const pkg = packages.find((pkg) => pkg.path === release.path);
    if (!pkg || seen.has(release.path))
      throw new Error("Unknown or duplicate release package.");
    if (
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.version) ||
      release.tagName !== `${pkg.component}-v${release.version}`
    )
      throw new Error("Invalid release version or tag.");
    if (!/^[a-f0-9]{40}$/.test(release.sha) || release.sha !== releases[0].sha)
      throw new Error("Releases must identify the same exact commit.");
    seen.add(release.path);
  }
  return {
    sha: releases[0]?.sha ?? null,
    packages: packages.flatMap((pkg) =>
      releases.filter((release) => release.path === pkg.path),
    ),
  };
}

export async function packPackage(path, destination) {
  const manifest = JSON.parse(
    await readFile(join(path, "package.json"), "utf8"),
  );
  const filename = `${manifest.name.replace("@", "").replaceAll("/", "-")}-${manifest.version}.tgz`;
  execFileSync("pnpm", ["pack", "--pack-destination", destination], {
    cwd: resolve(path),
    stdio: "pipe",
  });
  const tarball = join(destination, filename);
  const integrity = `sha512-${createHash("sha512")
    .update(await readFile(tarball))
    .digest("base64")}`;
  return { name: manifest.name, version: manifest.version, tarball, integrity };
}

export async function lookupPublished(name, version, fetchRegistry = fetch) {
  const response = await fetchRegistry(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { signal: AbortSignal.timeout(30_000), cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      `Registry lookup failed for ${name}@${version}: HTTP ${response.status}`,
    );
  return response.json();
}

export async function publishPackages(artifacts, { lookup, publish }) {
  for (const artifact of artifacts) {
    const existing = await lookup(artifact.name, artifact.version);
    if (existing) {
      if (existing.dist?.integrity !== artifact.integrity)
        throw new Error(
          `Published ${artifact.name}@${artifact.version} differs from the local artifact. Refusing to skip or overwrite.`,
        );
      console.log(`Already published: ${artifact.name}@${artifact.version}`);
      continue;
    }
    await publish(artifact.tarball);
    console.log(`Published: ${artifact.name}@${artifact.version}`);
  }
}
