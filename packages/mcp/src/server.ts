import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  historyKindSchema,
  historyPageSchema,
  orderIdSchema,
  orderSchema,
  reportSchema,
  type Trading212Client,
  tickerSchema,
} from "@trading212-local/client";
import { z } from "zod";
import { bounded, section, toolResult } from "./results.js";

const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const write = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};
const pagination = {
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(1_000_000).default(0),
};

export function createTrading212Server(api: Trading212Client): McpServer {
  const server = new McpServer(
    { name: "trading212", version: "0.1.0" },
    {
      instructions: `Trading 212 ${api.environment} account. Trading ${api.allowTrading ? "enabled" : "disabled"}. Order submissions are non-idempotent: never retry an unknown outcome automatically. Obtain user approval through your host before trading. Account snapshots are not atomic. No live quote endpoint is available.`,
    },
  );

  server.registerTool(
    "connection_status",
    {
      description:
        "Verify account-summary access and report the selected environment and configured trading access. This does not verify every API permission.",
      inputSchema: {},
      annotations: read,
    },
    (_, extra) =>
      toolResult(api, async () => {
        const account = await api.account.summary({ signal: extra.signal });
        return {
          authenticated: true,
          accountId: account.id,
          currency: account.currency,
          tradingEnabled: api.allowTrading,
          verifiedAccess: ["account_summary"],
        };
      }),
  );

  server.registerTool(
    "account_snapshot",
    {
      description:
        "Combine account summary, positions and pending orders. Returns independent section timestamps and partial errors; not an atomic snapshot.",
      inputSchema: { limit: pagination.limit },
      annotations: read,
    },
    ({ limit }, extra) =>
      toolResult(api, async () => {
        const options = { signal: extra.signal };
        const [account, positions, orders] = await Promise.all([
          section(() => api.account.summary(options)),
          section(async () =>
            bounded(await api.positions.list(options), limit),
          ),
          section(async () => bounded(await api.orders.list(options), limit)),
        ]);
        return {
          account,
          positions,
          orders,
          partial: [account, positions, orders].some(
            (result) => "error" in result,
          ),
        };
      }),
  );

  server.registerTool(
    "get_positions",
    {
      description:
        "Get open positions, optionally filtered by exact Trading 212 ticker. Offset pagination applies to the current response, not a frozen snapshot.",
      inputSchema: { ticker: tickerSchema.optional(), ...pagination },
      annotations: read,
    },
    ({ ticker, limit, offset }, extra) =>
      toolResult(api, async () => {
        const positions = await api.positions.list({ signal: extra.signal });
        return bounded(
          ticker
            ? positions.filter(
                (position) => position.instrument?.ticker === ticker,
              )
            : positions,
          limit,
          offset,
        );
      }),
  );

  server.registerTool(
    "search_instruments",
    {
      description:
        "Search instrument metadata by ticker, name or ISIN. Cached for ten minutes; returns a bounded list and its original fetch time. Not a live price feed.",
      inputSchema: {
        query: z.string().trim().min(1).max(200),
        limit: pagination.limit,
      },
      annotations: read,
    },
    ({ query, limit }, extra) =>
      toolResult(api, () =>
        api.instruments.search(query, limit, { signal: extra.signal }),
      ),
  );

  server.registerTool(
    "get_exchanges",
    {
      description:
        "Get cached exchange metadata and working schedules, optionally for a single exchange ID.",
      inputSchema: { id: orderIdSchema.optional(), ...pagination },
      annotations: read,
    },
    ({ id, limit, offset }, extra) =>
      toolResult(api, async () => {
        const result = await api.exchanges.list({ signal: extra.signal });
        return {
          ...result,
          ...bounded(
            id
              ? result.items.filter((exchange) => exchange.id === id)
              : result.items,
            limit,
            offset,
          ),
        };
      }),
  );

  server.registerTool(
    "list_pending_orders",
    {
      description:
        "List currently pending orders. Filled/cancelled orders belong in get_history. Offset pagination is not a frozen snapshot.",
      inputSchema: { ticker: tickerSchema.optional(), ...pagination },
      annotations: read,
    },
    ({ ticker, limit, offset }, extra) =>
      toolResult(api, async () => {
        const orders = await api.orders.list({ signal: extra.signal });
        return bounded(
          ticker
            ? orders.filter(
                (order) =>
                  (order.ticker ?? order.instrument?.ticker) === ticker,
              )
            : orders,
          limit,
          offset,
        );
      }),
  );

  server.registerTool(
    "get_pending_order",
    {
      description:
        "Get one pending order by ID. Not found does not prove rejection or cancellation; inspect history for completed orders.",
      inputSchema: { id: orderIdSchema },
      annotations: read,
    },
    ({ id }, extra) =>
      toolResult(api, () => api.orders.get(id, { signal: extra.signal })),
  );

  server.registerTool(
    "get_history",
    {
      description:
        "Get one history page (maximum 50 items). Continue with the returned nextPagePath and the same kind, without limit/ticker. Ticker applies only to orders/dividends.",
      inputSchema: { kind: historyKindSchema, ...historyPageSchema.shape },
      annotations: read,
    },
    ({ kind, ...options }, extra) =>
      toolResult(api, () =>
        api.history.page(kind, options, { signal: extra.signal }),
      ),
  );

  server.registerTool(
    "list_reports",
    {
      description:
        "List CSV report status and available download links. Rate limited to once per minute. Links may contain sensitive access tokens; do not share them.",
      inputSchema: { id: orderIdSchema.optional(), ...pagination },
      annotations: read,
    },
    ({ id, limit, offset }, extra) =>
      toolResult(api, async () => {
        const reports = await api.reports.list({ signal: extra.signal });
        return {
          ...bounded(
            id ? reports.filter((report) => report.reportId === id) : reports,
            limit,
            offset,
          ),
          suggestedPollAfterMs: 60_000,
        };
      }),
  );

  server.registerTool(
    "request_report",
    {
      description:
        "Request asynchronous CSV generation for a date range and categories. Returns a report ID; use list_reports later. Does not place trades; available with trading disabled.",
      inputSchema: { report: reportSchema },
      annotations: { ...write, destructiveHint: false },
    },
    ({ report }, extra) =>
      toolResult(api, async () => ({
        ...(await api.reports.request(report, { signal: extra.signal })),
        suggestedPollAfterMs: 60_000,
      })),
  );

  if (api.allowTrading) {
    server.registerTool(
      "place_order",
      {
        description: `Place a ${api.environment === "live" ? "REAL-MONEY" : "demo"} order after user approval through the host. Specify an exact ticker, positive share quantity and explicit buy/sell side. Price fields use the instrument's price denomination. No automatic retries: an unknown outcome may already have placed an order.`,
        inputSchema: { order: orderSchema },
        annotations: write,
      },
      ({ order }, extra) =>
        toolResult(api, () =>
          api.orders.place(order, { signal: extra.signal }),
        ),
    );

    server.registerTool(
      "cancel_order",
      {
        description: `Request cancellation of one ${api.environment} pending order after user approval. Acceptance is not proof of cancellation; inspect pending orders and history.`,
        inputSchema: { id: orderIdSchema },
        annotations: write,
      },
      ({ id }, extra) =>
        toolResult(api, () => api.orders.cancel(id, { signal: extra.signal })),
    );
  }
  return server;
}
