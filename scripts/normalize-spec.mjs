import { readFile, writeFile } from "node:fs/promises";

const spec = JSON.parse(
  await readFile(
    new URL("../openapi/trading212.json", import.meta.url),
    "utf8",
  ),
);
// Upstream combines two schemes using the same Authorization header. Use documented Basic auth.
for (const path of Object.values(spec.paths)) {
  for (const operation of Object.values(path)) {
    if (operation.operationId) operation.security = [{ authWithSecretKey: [] }];
  }
}
const schemas = spec.components.schemas;
for (const schema of Object.values(schemas)) {
  if (schema.properties?.nextPagePath)
    schema.properties.nextPagePath.nullable = true;
}
// Request requirements enforced by this client; upstream currently omits required lists.
const required = {
  MarketRequest: ["ticker", "quantity"],
  LimitRequest: ["ticker", "quantity", "limitPrice", "timeValidity"],
  StopRequest: ["ticker", "quantity", "stopPrice", "timeValidity"],
  StopLimitRequest: [
    "ticker",
    "quantity",
    "stopPrice",
    "limitPrice",
    "timeValidity",
  ],
  PublicReportRequest: ["dataIncluded", "timeFrom", "timeTo"],
  ReportDataIncluded: [
    "includeDividends",
    "includeInterest",
    "includeOrders",
    "includeTransactions",
  ],
};
for (const [name, fields] of Object.entries(required)) {
  if (!schemas[name]) throw new Error(`Upstream schema removed: ${name}`);
  for (const field of fields) {
    if (!schemas[name].properties[field])
      throw new Error(`Upstream field removed: ${name}.${field}`);
  }
  schemas[name].required = fields;
}
await writeFile(
  process.env.T212_NORMALIZED_SPEC ??
    new URL("../openapi/trading212.normalized.json", import.meta.url),
  `${JSON.stringify(spec, null, 2)}\n`,
);
