# @mingchuno/trading212-mcp

Local stdio MCP server for Trading 212. Requires Node.js 22.18+. Independent community project; not affiliated with Trading 212.

## Run

```sh
npx --yes @mingchuno/trading212-mcp --version
```

`npx` runs the latest published version without a global install. The server runs on your machine and connects directly to the broker. No hosted service or OAuth flow is required.

## Configure credentials

Generate a key and secret under Trading 212 → Settings → API (Beta), with permissions appropriate to your use. Use credentials for the selected live or demo environment. [Trading 212 instructions](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key).

Create a private JSON file outside your project:

```json
{
  "apiKey": "YOUR_API_KEY",
  "apiSecret": "YOUR_API_SECRET"
}
```

On macOS/Linux, restrict access with `chmod 600 /absolute/path/trading212.json`. It must be an owner-only regular file, not a symlink. Restart the server after changing credentials.

| Environment variable | Meaning | Default |
| --- | --- | --- |
| `T212_ENV` | `live` or `demo` | `live` |
| `T212_CREDENTIALS_FILE` | Absolute path to the credentials JSON | Unset |
| `T212_API_KEY`, `T212_API_SECRET` | Alternative to the credentials file; supply both | Unset |
| `T212_ALLOW_TRADING` | Exactly `true` enables placing/cancelling orders | `false` |

Choose one credential source; combining file and key/secret variables is rejected. `.env` files are not loaded automatically. Credentials belong in host configuration, never tool arguments.

## Connect your MCP host

Add a local stdio server using your host's configuration format. Hosts supporting `mcpServers` can use:

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

[Codex](https://developers.openai.com/codex/mcp) uses TOML. Add this to `~/.codex/config.toml` (or `.codex/config.toml` in a trusted project):

```toml
[mcp_servers.trading212]
command = "npx"
args = ["--yes", "@mingchuno/trading212-mcp"]

[mcp_servers.trading212.env]
T212_ENV = "live"
T212_CREDENTIALS_FILE = "/absolute/private/path/trading212.json"
T212_ALLOW_TRADING = "false"
```

If a desktop host cannot find `npx`, use its absolute path (`command -v npx` on macOS/Linux). As an alternative, install the package with `npm install --global @mingchuno/trading212-mcp`, set `command` to `trading212-mcp`, and omit `args`. Avoid launching through `pnpm run`, whose banners can interfere with stdio.

Check access from a terminal with the same configuration:

```sh
T212_ENV=live \
T212_CREDENTIALS_FILE=/absolute/private/path/trading212.json \
npx --yes @mingchuno/trading212-mcp doctor
```

`doctor` makes one authenticated account-summary request; it does not test every API permission. `--help` and `--version` need no credentials. Help and diagnostics go to stderr; stdout is reserved for MCP. Starting the server directly waits for a host on stdin rather than opening a web page.

## Alternative: inject credentials from a password manager

You can keep the API key and secret in a password manager and inject them as environment variables at startup. For example, [1Password CLI's `op run`](https://www.1password.dev/cli/reference/commands/run) resolves secret references before launching the MCP. Configure [CLI authentication](https://developer.1password.com/docs/cli/get-started/) first, then replace the references below with those for your item:

```json
{
  "mcpServers": {
    "trading212": {
      "command": "op",
      "args": ["run", "--", "npx", "--yes", "@mingchuno/trading212-mcp"],
      "env": {
        "T212_ENV": "live",
        "T212_API_KEY": "op://Personal/Trading212/apiKey",
        "T212_API_SECRET": "op://Personal/Trading212/apiSecret",
        "T212_ALLOW_TRADING": "false"
      }
    }
  }
}
```

Equivalent Codex TOML:

```toml
[mcp_servers.trading212]
command = "op"
args = ["run", "--", "npx", "--yes", "@mingchuno/trading212-mcp"]

[mcp_servers.trading212.env]
T212_ENV = "live"
T212_API_KEY = "op://Personal/Trading212/apiKey"
T212_API_SECRET = "op://Personal/Trading212/apiSecret"
T212_ALLOW_TRADING = "false"
```

Use this instead of the file-based server entry, and leave `T212_CREDENTIALS_FILE` unset. Configuration contains references only; no plaintext broker-credential file is needed. Resolved secrets remain in the running process's environment/memory. Restart the MCP after rotating them.

The MCP only reads `T212_API_KEY` and `T212_API_SECRET`; it does not interpret `op://` references or depend on 1Password. Other managers can supply the same variables through their own process-launching CLI or integration.

For desktop hosts, ensure `op` and `npx` are discoverable (or use absolute executable paths) and that CLI authentication works without a terminal prompt. Approve any 1Password desktop unlock prompt before the host's startup timeout expires.

## Use the tools

Ask your assistant to summarize your account, inspect positions and pending orders, search instruments, or retrieve a bounded history page. [Tool reference](https://github.com/mingchuno/trading212-mcp#tools).

Report generation remains available with trading disabled. It returns immediately; poll no faster than the suggested interval. Account snapshots are independent reads, not an atomic portfolio view.

To enable `place_order` and `cancel_order`, set `T212_ALLOW_TRADING=true` in host configuration and restart. Test in demo first, using `T212_ENV=demo` and matching credentials. Configure host approval for real-money trades; the server cannot independently verify human approval.

No mutation is retried automatically. An unknown outcome requires checking pending orders **and history** before considering another submission. Cancellation acceptance means a request was accepted, not that the order was cancelled.

## Embed

Import `createTrading212Server(client)` and connect an MCP transport. `loadConfig(env)` reads the same environment settings used by the CLI. For programmatic broker access, use [@mingchuno/trading212-client](https://www.npmjs.com/package/@mingchuno/trading212-client).

## License

MIT. See the included `LICENCE` file.
