# Release maintenance

Release Please provides a reviewable release decision for independently consumable packages. One combined PR keeps client and dependent MCP changes together. Review its versions and changelogs before merging; merging authorizes the release.

## Contributor contract

Squash PRs with a Conventional Commit title, such as `fix(client): handle empty history`. Preserve breaking-change information in the squash body or use `!` in the title. Package selection follows changed paths, not just the commit scope; root-only changes may produce no release.

Version policy lives in [release-please-config.json](../release-please-config.json), with examples enforced by [release fixtures](../scripts/test/release-please.test.mjs). Keep `workspace:^` in the MCP dependency and pack with pnpm so the published manifest contains a registry-compatible range. Release Please does not maintain the pnpm lockfile; a frozen install on the release PR must still pass.

## External configuration

These settings live outside Git and must be preserved when migrating or recreating the repository:

- Install a private GitHub App on the repository with Contents, Pull requests, and Issues read/write. Store its ID and PEM as repository secrets `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY`. The App allows release PR checks to run automatically; it needs no webhook server.
- Use squash merging with the PR title and description. Protect `main` with the verification and PR-title checks. A solo-maintainer setup need not require another reviewer's approval.
- Create the GitHub environment `npm`, restricted to the `main` branch. Required reviewers introduce a manual publishing gate.
- Configure a trusted publisher on each npm package: owner `mingchuno`, repository `trading212-mcp`, workflow `release.yml`, environment `npm`. Allow direct publication, not staging only. These identifiers must stay aligned with [the workflow](../.github/workflows/release.yml).
- Set repository variable `NPM_PUBLISH_ENABLED=true` to enable publishing. No persistent npm token or broker credentials are required. Public repository/package visibility is required for automatic public provenance.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for current account and publisher requirements.

For a package's first publication, leave automated publishing disabled until the package exists and its trusted publisher is configured. Publish from a clean checkout of its release tag: verify, build, test the packed installation, then authenticate interactively and publish the pnpm tarball with public access. Publish the client before its dependent MCP package. Initial manual publication does not validate OIDC; the subsequent automated release does. Choose a license before public publication.

## Recovery

Publication is not atomic: the client may be published before an MCP failure. After fixing a publishing failure, choose **Re-run failed jobs** on the same Actions run to retain the successful release job's package plan and exact commit. An existing version is skipped only when its registry integrity matches the rebuilt tarball; differing contents require a new version.

Re-running the whole workflow or dispatching a new run is not a publication retry: Release Please may find no new releases. If the release job itself failed after creating tags, inspect its logs and existing releases before recovering. Do not delete tags or attempt to overwrite published versions.

To pause future publication, unset `NPM_PUBLISH_ENABLED` or set it to `false`. Inspect active runs separately because they may already have evaluated the variable.
