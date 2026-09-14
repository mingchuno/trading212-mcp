# Design boundaries

The client is independent of MCP so applications can reuse broker access without adopting tool schemas or host configuration. The MCP layer adds bounded, task-oriented views: snapshots can return partial results, instrument search filters large inventories, and report generation returns a handle rather than holding a tool call open while polling.

## Generated contract

[The upstream snapshot](../openapi/trading212.json) is preserved separately from [normalization policy](../scripts/normalize-spec.mjs). The upstream contract combines two authentication schemes on one header, omits request-field requirements, and does not express documented pagination nullability. Normalization resolves those gaps for this client; it is not a complete repair of the broker's contract. Response fields remain optional.

Review these assumptions when updating the snapshot. Generated types alone do not establish that a trading request is valid. The public `@mingchuno/trading212-client/generated` export is a low-level escape hatch that bypasses the maintained client's validation, trading gate, and secret handling. Deprecated Pie operations remain available for compatibility but are excluded from MCP.

Upstream references: [API limitations](https://docs.trading212.com/api/section/general-information/api-limitations), [OpenAPI JSON](https://docs.trading212.com/_bundle/api.json), and [API-key setup](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key). The pinned snapshot is the reproducible contract; consult upstream when reassessing broker behavior.

## Trust and failure boundaries

Credentials belong to startup configuration, never tool arguments. The server cannot attest that a human approved a call: host approval and the transport's trading gate serve different purposes. Environments are explicit because automatic fallback could submit an intended demo operation to a live account.

A mutation can succeed at the broker even when its response is lost. Mutations therefore never retry automatically; reconciliation needs history as well as pending orders. Absence from pending orders alone cannot prove rejection. Redirects and pagination destinations are restricted because they carry authenticated requests; report-download URLs do not inherit authorization.

Broker rate budgets are shared per account, while scheduling and caches belong to individual client instances. Other processes or API keys can consume the same budget, so local scheduling cannot eliminate 429 responses. Coalesced metadata requests share the first caller's cancellation signal. Account snapshots are independent reads, not an atomic portfolio view.
