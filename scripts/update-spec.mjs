import { writeFile } from "node:fs/promises";

const response = await fetch("https://docs.trading212.com/_bundle/api.json", {
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`Spec download failed: ${response.status}`);
const spec = await response.json();
if (!spec.openapi || !spec.paths || !spec.components?.schemas)
  throw new Error("Invalid OpenAPI document");
await writeFile(
  new URL("../openapi/trading212.json", import.meta.url),
  `${JSON.stringify(spec, null, 2)}\n`,
);
console.log(
  "Updated upstream snapshot. Review changes, then run pnpm generate and pnpm verify.",
);
