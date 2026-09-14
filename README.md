# Trading 212 client and MCP

Two Node.js/TypeScript packages in a pnpm workspace:

- `@mingchuno/trading212-client`: generated API coverage plus authentication, validation, pagination, caching, and rate handling.
- `@mingchuno/trading212-mcp`: local stdio MCP server using that client. Ten tools by default; twelve with trading enabled.

Repository: `mingchuno/trading212-mcp`. Packages are not yet published. Requires Node.js **22.18+** and pnpm **10.18.0**. TypeScript **6.0.3** is pinned because Hey API 0.99.0 uses the JavaScript compiler API unavailable in TypeScript 7.0.2.

Development uses the exact Node.js and pnpm versions in `mise.toml`; TypeScript and Biome are pinned in `package.json`. Activate mise in your shell, or prefix commands with `mise exec --`.

## Start

```sh
mise install
pnpm install --frozen-lockfile
pnpm build
```

Generate an API key and secret under **Trading 212 → Settings → API (Beta)**. Choose permissions appropriate to the tools you intend to use. The secret is shown once. See [Trading 212's instructions](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key).

Supply credentials through your MCP host's environment/secret mechanism:

| Variable | Meaning | Default |
| --- | --- | --- |
| `T212_ENV` | `live` or `demo` | `live` |
| `T212_API_KEY` | API key | Required with secret |
| `T212_API_SECRET` | API secret | Required with key |
| `T212_CREDENTIALS_FILE` | Absolute path to JSON containing `apiKey` and `apiSecret` | Alternative to both variables |
| `T212_ALLOW_TRADING` | Exactly `true` or `false` | `false` |

Credentials files must be owner-only regular files (`chmod 600` on Unix); symlinks are rejected. Do not combine a credentials file with credential environment variables. Files are read at startup, so restart after rotation. `.env` files are not loaded automatically. Use separate server instances for different accounts or environments.

Run `pnpm doctor` to check account-summary access. This makes one authenticated read and does not verify every permission. Start the server with `node packages/mcp/dist/cli.js`. It reads stdin and writes only MCP protocol messages to stdout; diagnostics go to stderr.

Example host configuration (replace absolute paths):

```json
{
  "mcpServers": {
    "trading212": {
      "command": "node",
      "args": ["/absolute/path/trading-212-mcp/packages/mcp/dist/cli.js"],
      "env": {
        "T212_ENV": "live",
        "T212_CREDENTIALS_FILE": "/absolute/private/path/credentials.json",
        "T212_ALLOW_TRADING": "false"
      }
    }
  }
}
```

Use the absolute Node executable path if your host does not inherit your shell PATH. Configure the host to launch Node directly: package-manager banners must not enter the stdio protocol.

The citty CLI supports `serve` (the default), `doctor`, `--help` / `-h`, and `--version` / `-v`. Subcommand help is available with `serve --help` and `doctor --help`; all help and diagnostics go to stderr.

## Tools

| Tool | Behavior |
| --- | --- |
| `connection_status` | Verify summary access; report environment and configured trading flag |
| `account_snapshot` | Summary, positions, and pending orders with independent timestamps/errors |
| `get_positions` | Current positions, optional exact ticker filter |
| `search_instruments` | Bounded ticker/name/ISIN metadata search |
| `get_exchanges` | Cached exchange schedules |
| `list_pending_orders` | Current pending orders, optional ticker filter |
| `get_pending_order` | One pending order by ID |
| `get_history` | One page of orders/dividends/transactions, maximum 50 items |
| `list_reports` | Report status and available download links |
| `request_report` | Start CSV generation; available with trading disabled |
| `place_order` | Market/limit/stop/stop-limit; requires trading enabled |
| `cancel_order` | Request cancellation; requires trading enabled |

List tools expose bounds and continuation information. History continuation uses the returned `nextPagePath` with the same `kind`, without overriding filters. Metadata is cached for ten minutes and reports its fetch time. Snapshots are not atomic; offset pagination over current positions/orders is not a frozen view.

## Trading behavior

Set `T212_ALLOW_TRADING=true` **outside tool arguments** to enable placement/cancellation in the selected environment. Host-side approval is required for the intended user experience; tool annotations and descriptions are advisory, not an authorization system. Do not configure your host to auto-approve real-money trading unless that is your intended policy.

Orders use an exact Trading 212 ticker, explicit `buy`/`sell`, and a positive share quantity. The client translates sells to negative API quantities and validates order-specific fields. It does not provide quotes, guarantee buying power, or estimate fills.

No mutations are automatically retried. `OUTCOME_UNKNOWN` means a request may already have been applied: inspect pending orders **and history** before deciding what to do. Absence from pending orders alone cannot prove rejection. Cancellation acceptance is only a request, not proof of completed cancellation. CSV generation is asynchronous; use `list_reports` after its suggested polling interval. Download links may be sensitive; the server does not download or forward credentials to them.

The upstream API is beta, supports Invest/Stocks ISA, and has primary-currency limitations. Deprecated Pie operations are available in the client but omitted from MCP. See [API research](docs/research/trading212-api.md).

## Development

```sh
pnpm verify             # regeneration drift, Biome, types, fixtures, build
pnpm format             # format/lint fixes in maintained code
pnpm spec:update        # explicitly download upstream JSON
pnpm generate           # normalize snapshot and regenerate SDK
pnpm test               # deterministic tests; no broker credentials required
pnpm pack:smoke         # install local tarballs in a temporary consumer (npm registry access)
```

Upstream JSON is preserved in `openapi/trading212.json`. Generation applies documented corrections in `scripts/normalize-spec.mjs`; never edit `src/generated` manually. JSON is the canonical input; [YAML](https://docs.trading212.com/_bundle/api.yaml) is the alternate upstream format. [Generation details](docs/architecture.md).

Fixture tests cover credentials, mutation gates, order validation, uncertain outcomes, pagination, rate scheduling, and MCP discovery/invocation. They do not establish broker-side execution behavior. For an authenticated smoke check, run `doctor` against your chosen account. Test order placement separately in demo before using live trading.

GitHub Actions runs `pnpm verify` on pushes, pull requests, and manual dispatches using the mise tool pins. CI uses fixtures and needs no Trading 212 credentials.
