import { appendFile } from "node:fs/promises";
import { releasePlan } from "./release-packages.mjs";

const outputs = JSON.parse(process.env.RELEASE_OUTPUTS);
const paths = JSON.parse(outputs.paths_released);
if (!Array.isArray(paths)) throw new Error("Expected released package paths.");
const plan = releasePlan(
  paths.map((path) => ({
    path,
    version: outputs[`${path}--version`],
    tagName: outputs[`${path}--tag_name`],
    sha: outputs[`${path}--sha`],
  })),
);
await appendFile(
  process.env.GITHUB_OUTPUT,
  `plan=${JSON.stringify(plan)}\nsha=${plan.sha ?? ""}\nreleased=${plan.packages.length > 0}\n`,
);
