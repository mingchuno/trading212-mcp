import { describe, expect, it, vi } from "vitest";
import { publishPackages, releasePlan } from "../release-packages.mjs";

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

describe("publication planning", () => {
  it("orders the client before its dependent and pins a single commit", () => {
    expect(releasePlan([mcp, client])).toEqual({
      sha,
      packages: [client, mcp],
    });
  });
  it("rejects unknown packages, malformed tags, and mixed release commits", () => {
    expect(() => releasePlan([{ ...client, path: "." }])).toThrow();
    expect(() => releasePlan([{ ...client, tagName: "main" }])).toThrow();
    expect(() =>
      releasePlan([client, { ...mcp, sha: "b".repeat(40) }]),
    ).toThrow();
    expect(() => releasePlan([client, client])).toThrow();
  });
});

describe("partial publication recovery", () => {
  it("skips an identical published version and continues with the next package", async () => {
    const publish = vi.fn();
    const lookup = vi
      .fn()
      .mockResolvedValueOnce({ dist: { integrity: "sha512-client" } })
      .mockResolvedValueOnce(null);
    await publishPackages(
      [
        {
          name: "@mingchuno/trading212-client",
          version: "0.2.0",
          integrity: "sha512-client",
          tarball: "/client.tgz",
        },
        {
          name: "@mingchuno/trading212-mcp",
          version: "0.1.1",
          integrity: "sha512-mcp",
          tarball: "/mcp.tgz",
        },
      ],
      { lookup, publish },
    );
    expect(publish).toHaveBeenCalledExactlyOnceWith("/mcp.tgz");
  });
  it("fails on a conflicting existing artifact instead of silently skipping", async () => {
    const publish = vi.fn();
    await expect(
      publishPackages(
        [
          {
            name: "pkg",
            version: "1.0.0",
            integrity: "sha512-local",
            tarball: "/pkg.tgz",
          },
        ],
        {
          lookup: async () => ({ dist: { integrity: "sha512-different" } }),
          publish,
        },
      ),
    ).rejects.toThrow("differs");
    expect(publish).not.toHaveBeenCalled();
  });
  it("stops before publishing dependents after a failure", async () => {
    const publish = vi.fn(async () => {
      throw new Error("publish failed");
    });
    await expect(
      publishPackages(
        [
          {
            name: "client",
            version: "1.0.0",
            integrity: "a",
            tarball: "/client.tgz",
          },
          {
            name: "mcp",
            version: "1.0.0",
            integrity: "b",
            tarball: "/mcp.tgz",
          },
        ],
        { lookup: async () => null, publish },
      ),
    ).rejects.toThrow("publish failed");
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe("registry lookup failures", () => {
  it("treats only 404 as an unpublished package", async () => {
    const { lookupPublished } = await import("../release-packages.mjs");
    await expect(
      lookupPublished(
        "pkg",
        "1.0.0",
        async () => new Response("", { status: 404 }),
      ),
    ).resolves.toBeNull();
    for (const status of [401, 429, 503]) {
      await expect(
        lookupPublished(
          "pkg",
          "1.0.0",
          async () => new Response("", { status }),
        ),
      ).rejects.toThrow(`HTTP ${status}`);
    }
  });
});
