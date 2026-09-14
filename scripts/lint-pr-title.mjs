import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const title = process.env.PR_TITLE;
if (!title || /[\r\n]/.test(title))
  throw new Error("Expected a single-line PR title.");
const result = spawnSync(
  process.execPath,
  [resolve("node_modules/@commitlint/cli/cli.js")],
  { input: title, encoding: "utf8" },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
