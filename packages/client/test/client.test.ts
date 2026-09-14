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
      const base = {
        side: "sell" as const,
        ticker: "AAPL_US_EQ",
        quantity: 0.5,
      };
      const order =
        type === "market"
          ? { ...base, type, extendedHours: true }
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
      const result = await client.orders.place(order);
      expect(result.id).toBe(1);
      const request = fetchMock.mock.calls[0]?.[0];
      expect(request?.method).toBe("POST");
      const { side: _side, type: _type, ...fields } = order;
      expect(result).toEqual({ ...fields, quantity: -0.5, id: 1 });
      expect(fetchMock.mock.calls[0]?.[0].url).toBe(
        `https://demo.trading212.com/api/v0/equity/orders/${type}`,
      );
    },
  );
});

describe("history continuation limits", () => {
  it.each(["0", "51", "1&limit=2", "01", "", "1.0"])(
    "rejects limit=%s before sending",
    async (limit) => {
      const fetchMock = vi.fn();
      const client = new Trading212Client({
        environment: "demo",
        apiKey: "key",
        apiSecret: "secret",
        fetch: fetchMock,
      });
      await expect(
        client.history.page("orders", {
          nextPagePath: `/api/v0/equity/history/orders?limit=${limit}`,
        }),
      ).rejects.toThrow("Continuation limit must be between 1 and 50.");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each(["limit=1&cursor=a%2Fb", "limit=50&cursor=123", "cursor=123"])(
    "preserves valid continuation query %s",
    async (query) => {
      const fetchMock = vi.fn(async () =>
        Response.json({ items: [], nextPagePath: null }),
      );
      const client = new Trading212Client({
        environment: "demo",
        apiKey: "key",
        apiSecret: "secret",
        fetch: fetchMock,
      });
      await client.history.page("orders", {
        nextPagePath: `/api/v0/equity/history/orders?${query}`,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `https://demo.trading212.com/api/v0/equity/history/orders?${query}`,
        }),
      );
    },
  );
});

describe("report and history validation", () => {
  const report = {
    timeFrom: "2026-01-01T00:00:00Z",
    timeTo: "2026-02-01T00:00:00Z",
    dataIncluded: {
      includeDividends: false,
      includeInterest: false,
      includeOrders: true,
      includeTransactions: false,
    },
  };
  it.each([
    { ...report, timeFrom: report.timeTo },
    { ...report, timeTo: "2025-01-01T00:00:00Z" },
    { ...report, timeFrom: "not-a-date" },
    {
      ...report,
      dataIncluded: { ...report.dataIncluded, includeOrders: false },
    },
  ])(
    "rejects invalid report ranges and empty categories before sending",
    async (input) => {
      const fetchMock = vi.fn();
      const api = new Trading212Client({ ...credentials, fetch: fetchMock });
      await expect(api.reports.request(input)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("rejects conflicting history filters and unsupported transaction filters", async () => {
    const fetchMock = vi.fn();
    const api = new Trading212Client({ ...credentials, fetch: fetchMock });
    await expect(
      api.history.page("transactions", { ticker: "AAPL_US_EQ" }),
    ).rejects.toThrow("Transactions do not support");
    await expect(
      api.history.page("orders", {
        nextPagePath: "/api/v0/equity/history/orders?cursor=1",
        limit: 1,
      }),
    ).rejects.toThrow("Use nextPagePath alone");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("order boundary rejection", () => {
  it.each([
    { type: "market", side: "buy", ticker: "AAPL_US_EQ", quantity: 0 },
    {
      type: "market",
      side: "buy",
      ticker: "AAPL_US_EQ",
      quantity: Number.POSITIVE_INFINITY,
    },
    { type: "market", side: "buy", ticker: "AAPL_US_EQ", quantity: Number.NaN },
    { type: "market", side: "buy", ticker: "../orders", quantity: 1 },
    {
      type: "market",
      side: "buy",
      ticker: "AAPL_US_EQ",
      quantity: 1,
      limitPrice: 2,
    },
    {
      type: "stop",
      side: "buy",
      ticker: "AAPL_US_EQ",
      quantity: 1,
      stopPrice: 0,
      timeValidity: "DAY",
    },
    {
      type: "limit",
      side: "buy",
      ticker: "AAPL_US_EQ",
      quantity: 1,
      limitPrice: -1,
      timeValidity: "DAY",
    },
    {
      type: "stop_limit",
      side: "buy",
      ticker: "AAPL_US_EQ",
      quantity: 1,
      stopPrice: 2,
      timeValidity: "DAY",
    },
  ])("rejects invalid order values without sending", async (input) => {
    const fetchMock = vi.fn();
    const api = new Trading212Client({
      ...credentials,
      allowTrading: true,
      fetch: fetchMock,
    });
    await expect(
      api.orders.place(input as Parameters<typeof api.orders.place>[0]),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "42", null])(
    "does not acknowledge invalid broker order ID %s",
    async (id) => {
      const fetchMock = vi.fn(async () => Response.json({ id }));
      const api = new Trading212Client({
        ...credentials,
        allowTrading: true,
        fetch: fetchMock,
      });
      await expect(
        api.orders.place({
          type: "market",
          side: "buy",
          ticker: "AAPL_US_EQ",
          quantity: 1,
        }),
      ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("blocks every deprecated pie mutation when trading is disabled", async () => {
    const fetchMock = vi.fn();
    const api = new Trading212Client({ ...credentials, fetch: fetchMock });
    for (const action of [
      () => api.deprecatedPies.create({}),
      () => api.deprecatedPies.update(1, {}),
      () => api.deprecatedPies.duplicate(1, {}),
      () => api.deprecatedPies.delete(1),
    ]) {
      await expect(action()).rejects.toMatchObject({
        code: "TRADING_DISABLED",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
