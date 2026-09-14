import { type Fetch, Trading212Client } from "@mingchuno/trading212-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTrading212Server } from "../src/server.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function connect(
  allowTrading = false,
  fetchMock: Fetch = vi.fn(async () => Response.json([])),
) {
  const api = new Trading212Client({
    environment: "demo",
    apiKey: "key",
    apiSecret: "secret",
    allowTrading,
    fetch: fetchMock,
  });
  const server = createTrading212Server(api);
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, fetchMock };
}

describe("MCP tools", () => {
  it("lists ten tools by default and excludes trading and deprecated pies", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(10);
    expect(tools.map((tool) => tool.name)).not.toContain("place_order");
    expect(tools.every((tool) => !tool.name.includes("pie"))).toBe(true);
  });
  it("exposes trading only when enabled and marks mutations accurately", async () => {
    const { client } = await connect(true);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(12);
    expect(
      tools.find((tool) => tool.name === "place_order")?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(
      tools.find((tool) => tool.name === "request_report")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
  });
  it("rejects invalid order variants without network calls", async () => {
    const { client, fetchMock } = await connect(true);
    const result = await client.callTool({
      name: "place_order",
      arguments: {
        order: {
          type: "limit",
          side: "buy",
          ticker: "AAPL_US_EQ",
          quantity: 1,
        },
      },
    });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reports partial snapshot failures without discarding successful sections", async () => {
    const fetchMock = vi.fn(async (request: Request) =>
      request.url.endsWith("/positions")
        ? Response.json({}, { status: 403 })
        : Response.json(
            request.url.endsWith("/summary") ? { totalValue: 100 } : [],
          ),
    );
    const { client } = await connect(false, fetchMock);
    const result = await client.callTool({
      name: "account_snapshot",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain(
      "PERMISSION_DENIED",
    );
    expect(JSON.stringify(result.structuredContent)).toContain("100");
  });
  it("returns redacted authentication errors", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "secret" }, { status: 401 }),
    );
    const { client } = await connect(false, fetchMock);
    const result = await client.callTool({
      name: "connection_status",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('"error":"secret"');
    expect(JSON.stringify(result)).toContain("AUTHENTICATION_FAILED");
  });
});

it("places and requests cancellation through MCP with explicit acknowledgement semantics", async () => {
  const bodies: unknown[] = [];
  const fetchMock = vi.fn(async (request: Request) => {
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    bodies.push(await request.json());
    return Response.json({ id: 42, status: "NEW" });
  });
  const { client } = await connect(true, fetchMock);
  const placed = await client.callTool({
    name: "place_order",
    arguments: {
      order: {
        type: "market",
        side: "sell",
        ticker: "AAPL_US_EQ",
        quantity: 0.5,
        extendedHours: false,
      },
    },
  });
  expect(placed.isError).not.toBe(true);
  expect(placed.structuredContent).toMatchObject({
    environment: "demo",
    data: { id: 42, status: "NEW" },
  });
  expect(bodies).toEqual([
    { ticker: "AAPL_US_EQ", quantity: -0.5, extendedHours: false },
  ]);
  const cancelled = await client.callTool({
    name: "cancel_order",
    arguments: { id: 42 },
  });
  expect(cancelled.structuredContent).toMatchObject({
    data: {
      id: 42,
      cancellationRequested: true,
      message: expect.stringContaining("may already be filling"),
    },
  });
  expect(
    fetchMock.mock.calls.map(([request]) => [
      request.method,
      new URL(request.url).pathname,
    ]),
  ).toEqual([
    ["POST", "/api/v0/equity/orders/market"],
    ["DELETE", "/api/v0/equity/orders/42"],
  ]);
});

it("requests a report with trading disabled and returns its polling handle", async () => {
  const report = {
    timeFrom: "2026-01-01T00:00:00Z",
    timeTo: "2026-02-01T00:00:00Z",
    dataIncluded: {
      includeDividends: true,
      includeInterest: false,
      includeOrders: false,
      includeTransactions: false,
    },
  };
  const bodies: unknown[] = [];
  const fetchMock = vi.fn(async (request: Request) => {
    bodies.push(await request.json());
    return Response.json({ reportId: 7 });
  });
  const { client } = await connect(false, fetchMock);
  const result = await client.callTool({
    name: "request_report",
    arguments: { report },
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    data: { reportId: 7, suggestedPollAfterMs: 60_000 },
  });
  expect(bodies).toEqual([report]);
  expect(fetchMock.mock.calls[0]?.[0]).toMatchObject({
    method: "POST",
    url: "https://demo.trading212.com/api/v0/equity/history/exports",
  });
});

it.each([
  {
    name: "get_positions",
    arguments: { ticker: "AAPL_US_EQ", limit: 1, offset: 1 },
    response: [
      { instrument: { ticker: "OTHER" } },
      { instrument: { ticker: "AAPL_US_EQ" }, quantity: 1 },
      { instrument: { ticker: "AAPL_US_EQ" }, quantity: 2 },
      { instrument: { ticker: "AAPL_US_EQ" }, quantity: 3 },
    ],
    expected: {
      items: [{ instrument: { ticker: "AAPL_US_EQ" }, quantity: 2 }],
      total: 3,
      nextOffset: 2,
      truncated: true,
    },
  },
  {
    name: "list_pending_orders",
    arguments: { ticker: "AAPL_US_EQ", limit: 1, offset: 1 },
    response: [
      { id: 1, ticker: "OTHER" },
      { id: 2, ticker: "AAPL_US_EQ" },
      { id: 3, instrument: { ticker: "AAPL_US_EQ" } },
    ],
    expected: {
      items: [{ id: 3, instrument: { ticker: "AAPL_US_EQ" } }],
      total: 2,
      nextOffset: null,
      truncated: false,
    },
  },
  {
    name: "get_exchanges",
    arguments: { id: 2 },
    response: [{ id: 1 }, { id: 2 }],
    expected: {
      items: [{ id: 2 }],
      total: 1,
      nextOffset: null,
      truncated: false,
    },
  },
  {
    name: "list_reports",
    arguments: { id: 2 },
    response: [
      { reportId: 1 },
      {
        reportId: 2,
        status: "Finished",
        downloadLink: "https://reports.example/report",
      },
    ],
    expected: {
      items: [
        {
          reportId: 2,
          status: "Finished",
          downloadLink: "https://reports.example/report",
        },
      ],
      total: 1,
      nextOffset: null,
      truncated: false,
      suggestedPollAfterMs: 60_000,
    },
  },
])(
  "filters and bounds $name results through MCP",
  async ({ name, arguments: args, response, expected }) => {
    const fetchMock = vi.fn(async () => Response.json(response));
    const { client } = await connect(false, fetchMock);
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      environment: "demo",
      fetchedAt: expect.any(String),
      data: expected,
    });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(result.structuredContent) },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

it("preserves history continuation and searches metadata through MCP", async () => {
  const fetchMock = vi.fn(async (request: Request) =>
    Response.json(
      request.url.includes("/history/")
        ? { items: [{ id: 1 }], nextPagePath: null }
        : [
            { ticker: "AAPL_US_EQ", name: "Apple" },
            { ticker: "OTHER", name: "Other" },
          ],
    ),
  );
  const { client } = await connect(false, fetchMock);
  const history = await client.callTool({
    name: "get_history",
    arguments: {
      kind: "orders",
      nextPagePath: "/api/v0/equity/history/orders?cursor=a%2Fb&limit=2",
    },
  });
  expect(history.structuredContent).toMatchObject({
    data: { items: [{ id: 1 }], nextPagePath: null },
  });
  expect(fetchMock.mock.calls[0]?.[0].url).toBe(
    "https://demo.trading212.com/api/v0/equity/history/orders?cursor=a%2Fb&limit=2",
  );
  const search = await client.callTool({
    name: "search_instruments",
    arguments: { query: " apple ", limit: 1 },
  });
  expect(search.structuredContent).toMatchObject({
    data: {
      items: [{ ticker: "AAPL_US_EQ", name: "Apple" }],
      totalMatches: 1,
      truncated: false,
    },
  });
});

it("returns an empty bounded page beyond the available positions", async () => {
  const { client } = await connect(false, async () =>
    Response.json([{ quantity: 1 }]),
  );
  const result = await client.callTool({
    name: "get_positions",
    arguments: { offset: 10 },
  });
  expect(result.structuredContent).toMatchObject({
    data: { items: [], total: 1, nextOffset: null, truncated: false },
  });
});

it("preserves unknown mutation outcomes and redacts transport errors through MCP", async () => {
  const fetchMock = vi.fn(async () => {
    throw new Error("private-key Authorization: secret");
  });
  const { client } = await connect(true, fetchMock);
  const result = await client.callTool({
    name: "place_order",
    arguments: {
      order: { type: "market", side: "buy", ticker: "AAPL_US_EQ", quantity: 1 },
    },
  });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    environment: "demo",
    error: {
      code: "OUTCOME_UNKNOWN",
      message: expect.stringContaining("do not resubmit automatically"),
    },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private-key|Authorization|secret/,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("returns connection identity and a pending order through MCP", async () => {
  const fetchMock = vi.fn(async (request: Request) =>
    Response.json(
      request.url.endsWith("/summary")
        ? { id: 123, currency: "GBP" }
        : { id: 42, status: "NEW" },
    ),
  );
  const { client } = await connect(false, fetchMock);
  const connection = await client.callTool({
    name: "connection_status",
    arguments: {},
  });
  expect(connection.structuredContent).toMatchObject({
    data: {
      authenticated: true,
      accountId: 123,
      currency: "GBP",
      tradingEnabled: false,
      verifiedAccess: ["account_summary"],
    },
  });
  const order = await client.callTool({
    name: "get_pending_order",
    arguments: { id: 42 },
  });
  expect(order.structuredContent).toMatchObject({
    data: { id: 42, status: "NEW" },
  });
  expect(fetchMock.mock.calls[1]?.[0].url).toBe(
    "https://demo.trading212.com/api/v0/equity/orders/42",
  );
});
