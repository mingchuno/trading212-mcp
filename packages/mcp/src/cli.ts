#!/usr/bin/env node
import { Trading212Client } from "@mingchuno/trading212-client";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type CommandContext,
  defineCommand,
  renderUsage,
  runCommand,
} from "citty";
import { ConfigurationError, loadConfig } from "./config.js";
import { publicError } from "./results.js";
import { createTrading212Server } from "./server.js";

import { version } from "./version.js";

const helpArgs = {
  help: { type: "boolean", alias: "h", description: "Show help" },
  version: { type: "boolean", alias: "v", description: "Show version" },
} as const;
class InformationDisplayed extends Error {}

async function setup({ args, rawArgs, cmd }: CommandContext<typeof helpArgs>) {
  // Citty permits unknown options/positionals. This CLI accepts credentials only via configuration.
  if (
    rawArgs.some(
      (arg) =>
        arg.startsWith("-") &&
        !["--help", "-h", "--version", "-v"].includes(arg),
    ) ||
    (!cmd.subCommands && args._.length > 0)
  ) {
    throw new ConfigurationError(
      "Unexpected arguments. Use --help; supply credentials through environment variables or a credentials file.",
    );
  }
  if (cmd.subCommands && args._.length > 0) return;
  if (args.help) {
    process.stderr.write(`${await renderUsage(cmd)}\n`);
    throw new InformationDisplayed();
  }
  if (args.version) {
    process.stderr.write(`${version}\n`);
    throw new InformationDisplayed();
  }
}

const serve = defineCommand({
  meta: {
    name: "serve",
    version,
    description: "Start the Trading 212 MCP server over stdio.",
  },
  args: helpArgs,
  setup,
  async run() {
    const api = new Trading212Client(await loadConfig());
    const server = createTrading212Server(api);
    await server.connect(new StdioServerTransport());
    const close = () => {
      void server.close().finally(() => {
        process.exitCode = 0;
      });
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  },
});

const doctor = defineCommand({
  meta: {
    name: "doctor",
    version,
    description:
      "Verify configuration and account-summary access with one authenticated read.",
  },
  args: helpArgs,
  setup,
  async run() {
    const api = new Trading212Client(await loadConfig());
    await api.account.summary();
    process.stderr.write(
      `${JSON.stringify({ ok: true, environment: api.environment, tradingEnabled: api.allowTrading, verifiedAccess: ["account_summary"] })}\n`,
    );
  },
});

const main = defineCommand({
  meta: {
    name: "trading212-mcp",
    version,
    description:
      "Trading 212 MCP. Defaults to serve. Configure T212_ENV=live|demo and T212_API_KEY / T212_API_SECRET, or T212_CREDENTIALS_FILE. Trading requires T212_ALLOW_TRADING=true.",
  },
  args: helpArgs,
  setup,
  default: "serve",
  subCommands: { serve, doctor },
});

// Use Citty's parser without runMain's stdout output and raw-error logging.
runCommand(main, { rawArgs: process.argv.slice(2) }).catch((error) => {
  if (error instanceof InformationDisplayed) return;
  const message =
    error instanceof ConfigurationError
      ? error.message
      : error instanceof Error && error.name === "CLIError"
        ? "Unknown command. Use --help."
        : publicError(error);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
