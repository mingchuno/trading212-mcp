import { afterEach, expect, it, vi } from "vitest";
import { Transport } from "../src/transport.js";

const config = {
  environment: "demo" as const,
  apiKey: "key",
  apiSecret: "secret",
  allowTrading: true,
};
afterEach(() => vi.useRealTimers());

it.each(["GET", "POST", "DELETE"])(
  "bounds %s timeouts before headers and during body consumption",
  async (method) => {
    for (const phase of ["headers", "body"]) {
      const fetchMock = vi.fn((request: Request) => {
        if (phase === "headers")
          return new Promise<Response>((_, reject) => {
            request.signal.addEventListener(
              "abort",
              () => reject(request.signal.reason),
              { once: true },
            );
          });
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"id":'));
                request.signal.addEventListener(
                  "abort",
                  () => controller.error(request.signal.reason),
                  { once: true },
                );
              },
            }),
          ),
        );
      });
      const transport = new Transport({
        ...config,
        fetch: fetchMock,
        timeoutMs: 20,
        readRetries: 0,
      });
      await expect(
        transport.fetch(
          new Request("https://demo.trading212.com/api/v0/equity/orders/1", {
            method,
          }),
        ),
      ).rejects.toMatchObject({
        code: method === "GET" ? "NETWORK_ERROR" : "OUTCOME_UNKNOWN",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  },
);

it.each(["GET", "POST", "DELETE"])(
  "classifies caller cancellation after %s submission without retrying",
  async (method) => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (request: Request) =>
        new Promise<Response>((_, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(request.signal.reason),
            { once: true },
          );
          controller.abort();
        }),
    );
    const transport = new Transport({
      ...config,
      fetch: fetchMock,
      readRetries: 3,
    });
    await expect(
      transport.fetch(
        new Request("https://demo.trading212.com/api/v0/equity/orders/1", {
          method,
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({
      code: method === "GET" ? "CANCELLED" : "OUTCOME_UNKNOWN",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

it.each([302, 408, 429, 500, 503])(
  "does not retry mutation HTTP %s responses",
  async (status) => {
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    const transport = new Transport({
      ...config,
      fetch: fetchMock,
      readRetries: 3,
    });
    await expect(
      transport.fetch(
        new Request("https://demo.trading212.com/api/v0/equity/orders/market", {
          method: "POST",
        }),
      ),
    ).rejects.toMatchObject({
      code: status === 429 ? "RATE_LIMITED" : "OUTCOME_UNKNOWN",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

it.each(["network", "server", "rate"])(
  "stops %s read retries at the configured attempt limit",
  async (failure) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      if (failure === "network") throw new Error("offline");
      return Response.json({}, { status: failure === "server" ? 503 : 429 });
    });
    const transport = new Transport({
      ...config,
      fetch: fetchMock,
      readRetries: 2,
      maxWaitMs: 60_000,
    });
    const rejected = expect(
      transport.fetch("https://demo.trading212.com/api/v0/equity/orders/1"),
    ).rejects.toMatchObject({
      code:
        failure === "network"
          ? "NETWORK_ERROR"
          : failure === "server"
            ? "API_ERROR"
            : "RATE_LIMITED",
    });
    await vi.advanceTimersByTimeAsync(2000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  },
);

it("shares pacing across order IDs and honors HTTP-date retry headers", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-14T00:00:00Z"));
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        {},
        {
          status: 429,
          headers: { "retry-after": "Mon, 14 Sep 2026 00:00:03 GMT" },
        },
      ),
    )
    .mockResolvedValueOnce(Response.json({ id: 2 }));
  const transport = new Transport({
    ...config,
    fetch: fetchMock,
    readRetries: 0,
    maxWaitMs: 60_000,
  });
  await expect(
    transport.fetch("https://demo.trading212.com/api/v0/equity/orders/1"),
  ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  const next = transport.fetch(
    "https://demo.trading212.com/api/v0/equity/orders/2",
  );
  await vi.advanceTimersByTimeAsync(2999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await next;
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
