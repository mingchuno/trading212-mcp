import { describe, expect, it, vi } from "vitest";
import { Trading212Client } from "../src/index.js";

const credentials = {
  environment: "demo" as const,
  apiKey: "key",
  apiSecret: "secret",
};
const json = (value: unknown, status = 200, headers = {}) =>
  Response.json(value, { status, headers });

describe("Trading212Client", () => {
  it("isolates credentials and environments between instances", async () => {
    const requests: Request[] = [];
    const fetchMock = vi.fn(async (request: Request) => {
      requests.push(request);
      return json({ id: 1 });
    });
    const first = new Trading212Client({ ...credentials, fetch: fetchMock });
    const second = new Trading212Client({
      ...credentials,
      environment: "live",
      apiKey: "second",
      fetch: fetchMock,
    });
    await Promise.all([first.account.summary(), second.account.summary()]);
    expect(requests.map((r) => new URL(r.url).hostname)).toEqual([
      "demo.trading212.com",
      "live.trading212.com",
    ]);
    expect(requests.map((r) => r.headers.get("authorization"))).toEqual([
      "Basic a2V5OnNlY3JldA==",
      "Basic c2Vjb25kOnNlY3JldA==",
    ]);
    expect(requests.every((r) => r.redirect === "error")).toBe(true);
  });

  it("blocks all account mutations by default before sending requests", async () => {
    const fetchMock = vi.fn();
    const client = new Trading212Client({ ...credentials, fetch: fetchMock });
    await expect(
      client.orders.place({
        type: "market",
        side: "buy",
        ticker: "AAPL_US_EQ",
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "TRADING_DISABLED" });
    await expect(client.orders.cancel(1)).rejects.toMatchObject({
      code: "TRADING_DISABLED",
    });
    await expect(client.deprecatedPies.delete(1)).rejects.toMatchObject({
      code: "TRADING_DISABLED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates order variants and translates positive sell quantity", async () => {
    const fetchMock = vi.fn(async (request: Request) =>
      json({ ...(await request.json()), id: 1 }),
    );
    const client = new Trading212Client({
      ...credentials,
      allowTrading: true,
      fetch: fetchMock,
    });
    const result = await client.orders.place({
      type: "limit",
      side: "sell",
      ticker: "AAPL_US_EQ",
      quantity: 0.5,
      limitPrice: 123,
      timeValidity: "DAY",
    });
    expect(result).toMatchObject({ quantity: -0.5, limitPrice: 123 });
    await expect(
      client.orders.place({
        type: "market",
        side: "buy",
        ticker: "AAPL_US_EQ",
        quantity: -1,
      }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries an ambiguous order submission or leaks underlying errors", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("secret Authorization: Basic a2V5OnNlY3JldA==");
    });
    const client = new Trading212Client({
      ...credentials,
      allowTrading: true,
      fetch: fetchMock,
    });
    await expect(
      client.orders.place({
        type: "market",
        side: "buy",
        ticker: "AAPL_US_EQ",
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats server failures during mutations as unknown and does not retry", async () => {
    const fetchMock = vi.fn(async () => json({ error: "secret" }, 503));
    const client = new Trading212Client({
      ...credentials,
      allowTrading: true,
      fetch: fetchMock,
    });
    await expect(client.orders.cancel(1)).rejects.toMatchObject({
      code: "OUTCOME_UNKNOWN",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects hostile and wrong-endpoint pagination links before sending credentials", async () => {
    const fetchMock = vi.fn();
    const client = new Trading212Client({ ...credentials, fetch: fetchMock });
    for (const nextPagePath of [
      "https://evil.test/api/v0/equity/history/orders",
      "//evil.test/api/v0/equity/history/orders",
      "/api/v0/equity/account/summary",
    ]) {
      await expect(
        client.history.page("orders", { nextPagePath }),
      ).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves complete pagination query and accepts null as the end", async () => {
    const fetchMock = vi.fn(async (_request: Request) =>
      json({ items: [], nextPagePath: null }),
    );
    const client = new Trading212Client({ ...credentials, fetch: fetchMock });
    await expect(
      client.history.page("orders", {
        nextPagePath:
          "/api/v0/equity/history/orders?limit=2&cursor=123&ticker=AAPL_US_EQ",
      }),
    ).resolves.toMatchObject({ nextPagePath: null });
    expect(fetchMock.mock.calls[0]?.[0].url).toBe(
      "https://demo.trading212.com/api/v0/equity/history/orders?limit=2&cursor=123&ticker=AAPL_US_EQ",
    );
  });

  it("coalesces concurrent metadata reads and returns cache timestamps", async () => {
    const fetchMock = vi.fn(async () =>
      json([{ ticker: "AAPL_US_EQ", name: "Apple" }]),
    );
    const client = new Trading212Client({ ...credentials, fetch: fetchMock });
    const [first, second] = await Promise.all([
      client.instruments.search("apple"),
      client.instruments.search("aapl"),
    ]);
    expect(first.items).toEqual(second.items);
    expect(first.fetchedAt).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns retry timing without waiting beyond the configured budget", async () => {
    const fetchMock = vi.fn(async () => json({}, 429, { "retry-after": "60" }));
    const client = new Trading212Client({
      ...credentials,
      fetch: fetchMock,
      maxWaitMs: 1,
    });
    await expect(client.account.summary()).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterMs: expect.any(Number),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("mutation acknowledgements", () => {
  it("does not claim order submission succeeded when the acknowledgement lacks an ID", async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    const client = new Trading212Client({
      ...credentials,
      allowTrading: true,
      fetch: fetchMock,
    });
    await expect(
      client.orders.place({
        type: "market",
        side: "buy",
        ticker: "AAPL_US_EQ",
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["market", "limit", "stop", "stop_limit"] as const)(
    "routes %s orders to the matching API endpoint",
    async (type) => {
      const fetchMock = vi.fn(async (request: Request) =>
        Response.json({ ...(await request.json()), id: 1 }),
      );
      const client = new Trading212Client({
        ...credentials,
        allowTrading: true,
        fetch: fetchMock,
      });
      const base = { side: "buy" as const, ticker: "AAPL_US_EQ", quantity: 1 };
      const order =
        type === "market"
          ? { ...base, type }
          : type === "limit"
            ? { ...base, type, limitPrice: 123, timeValidity: "DAY" as const }
            : type === "stop"
              ? { ...base, type, stopPrice: 120, timeValidity: "DAY" as const }
              : {
                  ...base,
                  type,
                  limitPrice: 123,
                  stopPrice: 120,
                  timeValidity: "DAY" as const,
                };
      await client.orders.place(order);
      expect(fetchMock.mock.calls[0]?.[0].url).toBe(
        `https://demo.trading212.com/api/v0/equity/orders/${type}`,
      );
    },
  );
});
