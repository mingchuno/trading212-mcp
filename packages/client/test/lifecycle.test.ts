import { afterEach, expect, it, vi } from "vitest";
import { MetadataCache } from "../src/cache.js";
import { Trading212Client } from "../src/client.js";
import { retryDelay } from "../src/scheduler.js";

const config = {
  environment: "demo" as const,
  apiKey: "key",
  apiSecret: "secret",
};
afterEach(() => vi.useRealTimers());

it("keeps cached metadata and its original timestamp until expiry, then coalesces refresh", async () => {
  vi.useFakeTimers();
  const cache = new MetadataCache<string[]>(1000);
  const load = vi
    .fn()
    .mockResolvedValueOnce(["old"])
    .mockResolvedValueOnce(["new"]);
  const first = await cache.get(load);
  await vi.advanceTimersByTimeAsync(999);
  expect(await cache.get(load)).toMatchObject({
    value: ["old"],
    fetchedAt: first.fetchedAt,
    cached: true,
  });
  await vi.advanceTimersByTimeAsync(1);
  const refreshed = await Promise.all([cache.get(load), cache.get(load)]);
  expect(refreshed[0]).toMatchObject({ value: ["new"], cached: false });
  expect(refreshed[0]?.fetchedAt).not.toBe(first.fetchedAt);
  expect(refreshed[1]).toEqual(refreshed[0]);
  expect(load).toHaveBeenCalledTimes(2);
});

it("allows a new metadata load after a shared failure", async () => {
  const cache = new MetadataCache<string[]>();
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(["recovered"]);
  const results = await Promise.allSettled([cache.get(load), cache.get(load)]);
  expect(results.map((result) => result.status)).toEqual([
    "rejected",
    "rejected",
  ]);
  expect(await cache.get(load)).toMatchObject({ value: ["recovered"] });
  expect(load).toHaveBeenCalledTimes(2);
});

it("shares the first metadata caller's cancellation", async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn(
    (request: Request) =>
      new Promise<Response>((_, reject) => {
        request.signal.addEventListener(
          "abort",
          () => reject(request.signal.reason),
          { once: true },
        );
      }),
  );
  const api = new Trading212Client({
    ...config,
    fetch: fetchMock,
    readRetries: 0,
  });
  const first = api.instruments.list({ signal: controller.signal });
  const second = api.instruments.list();
  const outcomes = Promise.allSettled([first, second]);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  controller.abort();
  expect((await outcomes).map((result) => result.status)).toEqual([
    "rejected",
    "rejected",
  ]);
});

it("traverses history preserving cursors and stops at the final page", async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        items: [{ id: 1 }],
        nextPagePath: "/api/v0/equity/history/orders?cursor=a%2Fb",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: 2 }], nextPagePath: null }),
    );
  const api = new Trading212Client({
    ...config,
    fetch: fetchMock,
    maxWaitMs: 60_000,
  });
  const pages = api.history.pages("orders", { limit: 2 });
  expect((await pages.next()).value).toMatchObject({ items: [{ id: 1 }] });
  await vi.advanceTimersByTimeAsync(10_000);
  const next = pages.next();
  expect((await next).value).toMatchObject({ items: [{ id: 2 }] });
  expect(await pages.next()).toEqual({ done: true, value: undefined });
  expect(fetchMock.mock.calls[1]?.[0].url).toBe(
    "https://demo.trading212.com/api/v0/equity/history/orders?cursor=a%2Fb",
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("rejects repeated history cursors without fetching indefinitely", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async () =>
    Response.json({
      items: [],
      nextPagePath: "/api/v0/equity/history/orders?cursor=1",
    }),
  );
  const api = new Trading212Client({
    ...config,
    fetch: fetchMock,
    maxWaitMs: 60_000,
  });
  const pages = api.history.pages("orders");
  await pages.next();
  await vi.advanceTimersByTimeAsync(10_000);
  const next = pages.next();
  await next;
  await expect(pages.next()).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("caps history iteration and honors cancellation before another page", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      items: [],
      nextPagePath: "/api/v0/equity/history/orders?cursor=1",
    }),
  );
  const api = new Trading212Client({ ...config, fetch: fetchMock });
  const pages = api.history.pages("orders", { maxPages: 1 });
  await pages.next();
  expect((await pages.next()).done).toBe(true);
  const controller = new AbortController();
  controller.abort();
  await expect(
    api.history.pages("orders", {}, { signal: controller.signal }).next(),
  ).rejects.toMatchObject({ code: "CANCELLED" });
  await expect(
    api.history.pages("orders", { maxPages: 0 }).next(),
  ).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("uses the later valid server retry deadline and ignores invalid or past values", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-14T00:00:00Z"));
  expect(
    retryDelay(
      new Headers({
        "retry-after": "Mon, 14 Sep 2026 00:00:10 GMT",
        "x-ratelimit-reset": String(Date.now() / 1000 + 20),
      }),
    ),
  ).toBe(20_000);
  expect(
    retryDelay(
      new Headers({ "retry-after": "invalid", "x-ratelimit-reset": "invalid" }),
    ),
  ).toBe(0);
  expect(retryDelay(new Headers({ "retry-after": "-1" }))).toBe(0);
});
