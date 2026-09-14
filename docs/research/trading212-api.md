# Trading 212 API research

Verified 2026-09-14 against the [official OpenAPI JSON](https://docs.trading212.com/_bundle/api.json), its embedded general-information text, and the [API-key Help Centre article](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key). No authenticated requests made.

## Inventory

The current specification contains 22 operations: 16 supported and six deprecated Pies operations. Paths below omit `/api/v0/equity`.

| Method | Path | Limit | Deprecated |
| --- | --- | --- | --- |
| GET | `/account/summary` | 1 req / 5s |  |
| GET | `/history/dividends` | 6 req / 1m0s |  |
| GET | `/history/exports` | 1 req / 1m0s |  |
| POST | `/history/exports` | 1 req / 30s |  |
| GET | `/history/orders` | 6 req / 1m0s |  |
| GET | `/history/transactions` | 6 req / 1m0s |  |
| GET | `/metadata/exchanges` | 1 req / 30s |  |
| GET | `/metadata/instruments` | 1 req / 50s |  |
| GET | `/orders` | 1 req / 5s |  |
| POST | `/orders/limit` | 1 req / 2s |  |
| POST | `/orders/market` | 50 req / 1m0s |  |
| POST | `/orders/stop` | 1 req / 2s |  |
| POST | `/orders/stop_limit` | 1 req / 2s |  |
| DELETE | `/orders/{id}` | 50 req / 1m0s |  |
| GET | `/orders/{id}` | 1 req / 1s |  |
| GET | `/pies` | 1 req / 30s | Yes |
| POST | `/pies` | 1 req / 5s | Yes |
| DELETE | `/pies/{id}` | 1 req / 5s | Yes |
| GET | `/pies/{id}` | 1 req / 5s | Yes |
| POST | `/pies/{id}` | 1 req / 5s | Yes |
| POST | `/pies/{id}/duplicate` | 1 req / 5s | Yes |
| GET | `/positions` | 1 req / 1s |  |

## Verified constraints

- Basic authentication uses API Key + API Secret. Keys have permissions; rate budgets are per account, shared across keys/IPs.
- Demo and live origins are `https://demo.trading212.com` and `https://live.trading212.com`; spec paths already contain `/api/v0`.
- Invest and Stocks ISA only; primary-currency execution, no multi-currency support. All four order types are available live, per the Help Centre.
- Sells use negative quantities. Placement is non-idempotent; cancellation acceptance does not prove cancellation. Maximum pending orders: 50 per ticker/account.
- History pages default to 20, maximum 50; follow `nextPagePath`. Metadata refreshes every ten minutes. Report generation is asynchronous.

## Specification corrections to review before generation

Observed directly in JSON: all operations combine Basic and legacy header auth in one security object (AND); all component schemas lack required-property lists; pagination models omit documented nullability. Rate headers and error payloads have no structured response schemas. Preserve upstream files; apply explicit, tested corrections separately.

## Design recommendations (inferences)

- Generate the complete client, including deprecated operations in a clearly marked namespace. Keep Pies outside the default MCP tool set.
- Use explicit environment configuration, default live reads per user preference with separately enabled real trading, and credential input outside model-visible tool arguments. Never auto-fallback between environments. Support key + secret first; make legacy token compatibility an explicit separate mode if needed.
- Separate safe GET retries from mutations. Never automatically retry ambiguous placement failures; return an unknown-outcome result requiring reconciliation.
- Respect response rate headers, bound waits and pagination, and document that other processes share the same account budget. Cache metadata with age markers.
- Prefer bounded account snapshots and filtered instrument search over dumping raw inventories. Return report IDs/status and retry timing rather than holding a tool call through minute-long polling.
- Expose typed side plus positive quantity at the MCP layer, translating to the API sign convention. Require explicit write enablement and trustworthy host/user approval; a model-generated confirmation flag is not authorization.
- Validate request fields manually where upstream schema omits constraints. Do not assume generated optional properties are valid trading requests. Keep response decoding tolerant of additions.
- Validate pagination paths against the selected origin and expected API path before sending credentials. Do not forward authorization headers to report-download URLs.

## Sources and scope

- [API limitations](https://docs.trading212.com/api/section/general-information/api-limitations): the web fetch rejected its Markdown content type; equivalent text was verified in the downloaded spec introduction.
- [JSON specification](https://docs.trading212.com/_bundle/api.json): endpoint inventory, descriptions, schemas, permissions, limits.
- [YAML specification](https://docs.trading212.com/_bundle/api.yaml): alternate upstream format; JSON used for this analysis.
- [API-key Help Centre](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key): Settings → API (Beta), selectable permissions/IP restrictions, one-time secret display, live order support, unsupported SIPP, and key-version differences between demo/live.
