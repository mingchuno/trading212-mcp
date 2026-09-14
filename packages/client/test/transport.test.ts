import { afterEach, describe, expect, it, vi } from "vitest";
import { Transport } from "../src/transport.js";

const config = {
  environment: "demo" as const,
  apiKey: "key",
  apiSecret: "secret",
};
const request = () =>
  new Request("https://demo.trading212.com/api/v0/equity/account/summary");
afterEach(() => vi.useRealTimers());

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("transport response handling", () => {
  it.each([
    { method: "GET", code: "INVALID_RESPONSE" },
    { method: "POST", code: "OUTCOME_UNKNOWN" },
  ])(
    "classifies malformed JSON for $method without retrying",
    async ({ method, code }) => {
      const fetchMock = vi.fn(async () => new Response("{invalid"));
      const transport = new Transport({
        ...config,
        allowTrading: true,
        fetch: fetchMock,
        maxWaitMs: 60_000,
        readRetries: 3,
      });

      await expect(
        transport.fetch(new Request(request(), { method })),
      ).rejects.toMatchObject({ code });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves an empty successful cancellation response", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const transport = new Transport({
      ...config,
      allowTrading: true,
      fetch: fetchMock,
    });
    const response = await transport.fetch(
      new Request("https://demo.trading212.com/api/v0/equity/orders/123", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("transport scheduling", () => {
  it("retries safe reads after the endpoint delay", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ id: 1 }));
    const transport = new Transport({
      ...config,
      fetch: fetchMock,
      maxWaitMs: 6000,
    });
    const result = transport.fetch(request());
    await vi.advanceTimersByTimeAsync(5000);
    expect((await result).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("honors server reset headers when another key used the account budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T00:00:00Z"));
    const fetchMock = vi.fn(async () =>
      Response.json(
        {},
        {
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(Date.now() / 1000 + 60),
          },
        },
      ),
    );
    const transport = new Transport({
      ...config,
      fetch: fetchMock,
      maxWaitMs: 0,
    });
    await transport.fetch(request());
    await expect(transport.fetch(request())).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterMs: 60_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("cancels a queued request promptly without sending it later", async () => {
    const controller = new AbortController();
    let release: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const transport = new Transport({ ...config, fetch: fetchMock });
    const first = transport.fetch(request());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const second = transport.fetch(
      new Request(request(), { signal: controller.signal }),
    );
    controller.abort();
    await expect(second).rejects.toMatchObject({ code: "CANCELLED" });
    release?.(Response.json({}));
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized continuation pages before network access", async () => {
    const { Trading212Client } = await import("../src/index.js");
    const fetchMock = vi.fn();
    const client = new Trading212Client({ ...config, fetch: fetchMock });
    await expect(
      client.history.page("orders", {
        nextPagePath: "/api/v0/equity/history/orders?limit=9999&cursor=1",
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("queue ordering and deadlines", () => {
  it("keeps a third request behind the active request when the middle waiter cancels", async () => {
    vi.useFakeTimers();
    const active = pendingResponse();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(active.promise)
      .mockResolvedValue(Response.json({}));
    const transport = new Transport({
      ...config,
      fetch: fetchMock,
      maxWaitMs: 60_000,
    });
    const first = transport.fetch(request());
    await vi.advanceTimersByTimeAsync(0);
    const controller = new AbortController();
    const second = transport.fetch(
      new Request(request(), { signal: controller.signal }),
    );
    controller.abort();
    await expect(second).rejects.toMatchObject({ code: "CANCELLED" });
    const third = transport.fetch(request());
    await vi.advanceTimersByTimeAsync(6_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    active.resolve(Response.json({}));
    await Promise.all([first, third]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("expires a queued request without sending it after the active request completes", async () => {
    vi.useFakeTimers();
    const active = pendingResponse();
    const fetchMock = vi.fn().mockReturnValue(active.promise);
    const transport = new Transport({
      ...config,
      fetch: fetchMock,
      maxWaitMs: 100,
    });
    const first = transport.fetch(request());
    await vi.advanceTimersByTimeAsync(0);
    const second = transport.fetch(request());
    const rejected = expect(second).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "Request queue wait exceeds the configured budget.",
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    active.resolve(Response.json({}));
    await first;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("allows another endpoint to complete while a request is active", async () => {
    const active = pendingResponse();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(active.promise)
      .mockResolvedValue(Response.json([]));
    const transport = new Transport({ ...config, fetch: fetchMock });
    const first = transport.fetch(request());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await expect(
      transport.fetch(
        new Request("https://demo.trading212.com/api/v0/equity/positions"),
      ),
    ).resolves.toHaveProperty("status", 200);
    active.resolve(Response.json({}));
    await first;
  });
});
