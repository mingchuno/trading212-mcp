import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type Fetch, Trading212Client } from "@trading212-local/client";
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
