# @trading212-local/mcp

Node.js 22.18+ local stdio MCP server. Provisional package name; not published.

Launch `trading212-mcp` after installation, or `node dist/cli.js` from this built package. Use `trading212-mcp doctor` for one authenticated account-summary check. Diagnostics go to stderr.

Configure `T212_ENV=live|demo` (default live) and `T212_API_KEY` / `T212_API_SECRET`, or `T212_CREDENTIALS_FILE` pointing to an owner-only regular JSON file with `apiKey` and `apiSecret`. Do not combine sources. Credentials never belong in tool arguments. `.env` is not loaded automatically.

Ten tools provide account/position/order reads, instrument search, exchanges, history, and report generation. `T212_ALLOW_TRADING=true` adds `place_order` and `cancel_order`; default false. `request_report` remains available without trading. Use host approval for real-money trades: the server cannot verify human approval independently.

No mutation is retried. Unknown outcomes require checking pending orders and history. Account snapshots are not atomic. Report creation returns immediately; poll no faster than the suggested interval. No hosted service or OAuth flow is required.

For embedding, import `createTrading212Server(client)` and connect an MCP transport. `loadConfig(env)` reads the same environment settings used by the CLI.
