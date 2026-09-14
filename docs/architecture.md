# Architecture

`MCP tools → Trading212Client → generated Hey API functions → guarded Fetch → Trading 212`

The client has no MCP dependency. Each instance owns credentials, rate scheduling, and metadata caches. The MCP package owns tool schemas, response bounds, partial snapshots, and local configuration. Both packages build ESM JavaScript and declarations with `tsc`.

## Generated contract

`openapi/trading212.json` is the pinned upstream snapshot. `normalize-spec.mjs` writes a separate normalized file with:

- Basic authentication alone: upstream combines Basic and legacy token schemes on the same header in one security requirement.
- Nullable `nextPagePath`, matching documented end-of-pagination behavior.
- Required fields for order/report requests, enforced by the maintained client.

Corrections are client policy where the upstream omits requirements; they are not claimed to be a complete repair of the upstream contract. Response properties remain optional. Generated functions cover all 22 operations, including six deprecated Pie operations. Generation checks compare temporary output byte-for-byte without changing the workspace.

`@mingchuno/trading212-client/generated` is an explicit low-level escape hatch. Its generated functions do not provide the maintained client's trading gate, validation, retries, or secret handling. Prefer `Trading212Client`. Deprecated Pie methods use generated request types and the transport mutation gate; they do not receive the stricter order/report validation.

## Transport

The maintained client permits only the configured origin and API prefix, disables redirects, and constructs Basic authentication inside the transport. Pagination additionally requires the matching history endpoint and a bounded limit. Upstream error bodies and underlying network errors are omitted from public errors to avoid credential leakage.

The scheduler conservatively spaces requests by documented endpoint limits, serializes each endpoint, and observes rate reset/remaining headers. Default settings: 15-second request timeout, 5-second queue/rate wait budget, at most one retry for eligible GET failures. Mutations never retry. Cancellation before submission is distinct from an unknown outcome after submission.

Budgets are shared by the broker **per account**, while local scheduling is per client instance. Other processes/keys can consume the budget; the client cannot coordinate them and may still receive 429. Metadata requests coalesce within one instance and cache for ten minutes. Concurrent cache misses share the first caller's request and cancellation signal. There is no persistent cache or cross-process lock.

## MCP boundaries

Ten tools are registered with trading disabled; two additional tools appear at startup when trading is enabled. `request_report` remains available because it generates a report without trading. Trading restrictions are also enforced in the transport.

Results carry environment and completion timestamps; metadata includes original fetch time. Account snapshots preserve section errors. No resource discovery round-trip is required. Host approval is advisory from the server's perspective: a local stdio process cannot attest that a human approved a tool invocation.

Credentials are supplied at startup, never through tool inputs. There is no OAuth flow, hosted service, secret persistence, or automatic environment fallback.
