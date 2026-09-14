![Trading 212 — TypeScript client and MCP](docs/assets/readme-banner.png)

# Trading 212 client + MCP

Connect Node.js applications and AI assistants to the Trading 212 public API. Typed requests, bounded history, account snapshots, and opt-in trading in two independently installable packages.

Independent community project; not affiliated with Trading 212. Requires **Node.js 22.18+**. MIT licensed.

| Package | Use it for | Guide |
| --- | --- | --- |
| [@mingchuno/trading212-client](https://www.npmjs.com/package/@mingchuno/trading212-client) | Trading 212 access from JavaScript or TypeScript | [Client usage](packages/client/README.md) |
| [@mingchuno/trading212-mcp](https://www.npmjs.com/package/@mingchuno/trading212-mcp) | Local stdio tools for an MCP-compatible assistant | [MCP setup](packages/mcp/README.md) |

## Use with an assistant

Check the server can run:

```sh
npx --yes @mingchuno/trading212-mcp --version
```

Add a local stdio server to your MCP host. This common JSON format is host-dependent; replace the credential path with your own:

```json
{
  "mcpServers": {
    "trading212": {
      "command": "npx",
      "args": ["--yes", "@mingchuno/trading212-mcp"],
      "env": {
        "T212_ENV": "live",
        "T212_CREDENTIALS_FILE": "/absolute/private/path/trading212.json",
        "T212_ALLOW_TRADING": "false"
      }
    }
  }
}
```

For [Codex](https://developers.openai.com/codex/mcp), add this to `~/.codex/config.toml`:

```toml
[mcp_servers.trading212]
command = "npx"
args = ["--yes", "@mingchuno/trading212-mcp"]

[mcp_servers.trading212.env]
T212_ENV = "live"
T212_CREDENTIALS_FILE = "/absolute/private/path/trading212.json"
T212_ALLOW_TRADING = "false"
```

See [MCP setup](packages/mcp/README.md) for creating the credentials file, checking the connection, and troubleshooting executable paths. No repository clone or development tooling is needed.

To keep plaintext credentials out of local configuration files, see the [password-manager environment injection alternative](packages/mcp/README.md#alternative-inject-credentials-from-a-password-manager), with 1Password examples in JSON and TOML.

Try asking: “Summarize my positions and pending orders” or “Find instruments matching Apple.” Trading starts disabled; report generation remains available.

## Use from code

```sh
npm install @mingchuno/trading212-client
```

```js
import { Trading212Client } from '@mingchuno/trading212-client';

const client = new Trading212Client({
  environment: 'live',
  apiKey: process.env.T212_API_KEY,
  apiSecret: process.env.T212_API_SECRET,
});

console.log(await client.account.summary());
```

Supply the environment variables before running your ESM application. See [client usage](packages/client/README.md) for pagination, errors, and trading configuration.

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

The upstream API is beta, supports Invest/Stocks ISA, and has primary-currency limitations. Deprecated Pie operations are available in the client but omitted from MCP. See [design boundaries and upstream references](docs/architecture.md).

## Development

Development uses the tool versions in `mise.toml`. TypeScript stays pinned because the generator requires its JavaScript compiler API.

```sh
mise install
pnpm install --frozen-lockfile
pnpm build
pnpm verify             # regeneration drift, Biome, types, fixtures, build
pnpm format             # format/lint fixes in maintained code
pnpm spec:update        # explicitly download upstream JSON
pnpm generate           # normalize snapshot and regenerate SDK
pnpm test               # deterministic tests; no broker credentials required
pnpm test:coverage      # maintained-source coverage: terminal, HTML, LCOV, JSON
pnpm pack:smoke         # install local tarballs in a temporary consumer (npm registry access)
```

Upstream JSON is preserved in `openapi/trading212.json`. Generation applies documented corrections in `scripts/normalize-spec.mjs`; never edit `src/generated` manually. JSON is the canonical input; [YAML](https://docs.trading212.com/_bundle/api.yaml) is the alternate upstream format. [Generation details](docs/architecture.md).

Fixture tests protect mutation gates and exact order payloads, uncertain outcomes and retry limits, active-request cancellation/timeouts, history traversal, cache lifecycle, credential-file rejection, and MCP tool results. They do not establish broker-side execution behavior. For an authenticated smoke check, run `doctor` against your chosen account. Test order placement separately in demo before using live trading.

GitHub Actions runs `pnpm verify` on pushes, pull requests, and manual dispatches using the mise tool pins. CI uses fixtures and needs no Trading 212 credentials. Verification generates coverage and the Verify workflow uploads the report as a 14-day artifact, including when tests fail. Open `coverage/index.html` locally. Coverage excludes generated SDK code and has no percentage threshold: critical behavioral assertions are the gate. CLI subprocess smoke tests run separately and are not represented in the Vitest coverage totals.

## Releases

Husky and CI enforce Conventional Commits. Release Please manages independent package versions and changelogs; merging its release PR publishes through npm trusted publishing once configured. See [release maintenance](docs/releases.md).
