import { z } from "zod";
import { MetadataCache } from "./cache.js";
import { Trading212Error } from "./errors.js";
import { createClient } from "./generated/client/index.js";
import * as sdk from "./generated/sdk.gen.js";
import type {
  DuplicateBucketRequest,
  Exchange,
  Order,
  PaginatedResponseHistoricalOrder,
  PaginatedResponseHistoryDividendItem,
  PaginatedResponseHistoryTransactionItem,
  PieRequest,
  TradableInstrument,
} from "./generated/types.gen.js";
import { type ClientConfig, Transport } from "./transport.js";
import {
  type HistoryKind,
  type HistoryPageOptions,
  historyKindSchema,
  historyPageSchema,
  type OrderInput,
  orderIdSchema,
  orderSchema,
  type ReportInput,
  type RequestOptions,
  reportSchema,
} from "./validation.js";

async function payload<T>(request: Promise<{ data: T }>): Promise<T> {
  return (await request).data;
}
async function acknowledgedOrder(
  request: Promise<{ data: Order }>,
): Promise<Order & { id: number }> {
  const order = await payload(request);
  const id = orderIdSchema.safeParse(order?.id);
  if (!id.success)
    throw new Trading212Error(
      "OUTCOME_UNKNOWN",
      "Submission response did not contain a valid order ID. Inspect pending orders and history; do not resubmit automatically.",
    );
  return { ...order, id: id.data };
}

export type HistoryPage =
  | PaginatedResponseHistoricalOrder
  | PaginatedResponseHistoryDividendItem
  | PaginatedResponseHistoryTransactionItem;

interface HistoryMethods {
  page(
    kind: HistoryKind,
    input?: HistoryPageOptions,
    options?: RequestOptions,
  ): Promise<HistoryPage>;
  pages(
    kind: HistoryKind,
    input?: HistoryPageOptions & { maxPages?: number },
    options?: RequestOptions,
  ): AsyncGenerator<HistoryPage>;
}

export class Trading212Client {
  readonly #transport: Transport;
  readonly #http;
  readonly #instrumentCache = new MetadataCache<TradableInstrument[]>();
  readonly #exchangeCache = new MetadataCache<Exchange[]>();

  constructor(config: ClientConfig) {
    this.#transport = new Transport(config);
    this.#http = createClient({
      baseUrl: this.#transport.origin,
      fetch: this.#transport.fetch,
      throwOnError: true,
      redirect: "error",
    });
  }

  get environment() {
    return this.#transport.environment;
  }
  get allowTrading() {
    return this.#transport.allowTrading;
  }
  private options(options?: RequestOptions) {
    return { client: this.#http, throwOnError: true as const, ...options };
  }

  readonly account = {
    summary: (options?: RequestOptions) =>
      payload(sdk.getAccountSummary(this.options(options))),
  };
  readonly positions = {
    list: (options?: RequestOptions) =>
      payload(sdk.getPositions(this.options(options))),
  };
  readonly instruments = {
    list: async (options?: RequestOptions) => {
      const result = await this.#instrumentCache.get(() =>
        payload(sdk.instruments(this.options(options))),
      );
      return {
        items: result.value,
        fetchedAt: result.fetchedAt,
        cached: result.cached,
      };
    },
    search: async (query: string, limit = 20, options?: RequestOptions) => {
      const term = z
        .string()
        .trim()
        .min(1)
        .max(200)
        .parse(query)
        .toLocaleLowerCase("en");
      z.number().int().min(1).max(100).parse(limit);
      const result = await this.instruments.list(options);
      const matches = result.items.filter((instrument) =>
        [
          instrument.ticker,
          instrument.name,
          instrument.shortName,
          instrument.isin,
        ].some((value) => value?.toLocaleLowerCase("en").includes(term)),
      );
      return {
        ...result,
        items: matches.slice(0, limit),
        totalMatches: matches.length,
        truncated: matches.length > limit,
      };
    },
  };
  readonly exchanges = {
    list: async (options?: RequestOptions) => {
      const result = await this.#exchangeCache.get(() =>
        payload(sdk.exchanges(this.options(options))),
      );
      return {
        items: result.value,
        fetchedAt: result.fetchedAt,
        cached: result.cached,
      };
    },
  };
  readonly orders = {
    list: (options?: RequestOptions) =>
      payload(sdk.orders(this.options(options))),
    get: (id: number, options?: RequestOptions) =>
      payload(
        sdk.orderById({
          ...this.options(options),
          path: { id: orderIdSchema.parse(id) },
        }),
      ),
    place: async (input: OrderInput, options?: RequestOptions) => {
      this.#transport.assertTradingAllowed();
      const order = orderSchema.parse(input);
      const quantity = order.side === "sell" ? -order.quantity : order.quantity;
      const body = { ticker: order.ticker, quantity };
      const shared = this.options(options);
      switch (order.type) {
        case "market":
          return acknowledgedOrder(
            sdk.placeMarketOrder({
              ...shared,
              body: { ...body, extendedHours: order.extendedHours },
            }),
          );
        case "limit":
          return acknowledgedOrder(
            sdk.placeLimitOrder({
              ...shared,
              body: {
                ...body,
                limitPrice: order.limitPrice,
                timeValidity: order.timeValidity,
              },
            }),
          );
        case "stop":
          return acknowledgedOrder(
            sdk.placeStopOrder1({
              ...shared,
              body: {
                ...body,
                stopPrice: order.stopPrice,
                timeValidity: order.timeValidity,
              },
            }),
          );
        case "stop_limit":
          return acknowledgedOrder(
            sdk.placeStopOrder({
              ...shared,
              body: {
                ...body,
                stopPrice: order.stopPrice,
                limitPrice: order.limitPrice,
                timeValidity: order.timeValidity,
              },
            }),
          );
      }
    },
    cancel: async (id: number, options?: RequestOptions) => {
      this.#transport.assertTradingAllowed();
      await sdk.cancelOrder({
        ...this.options(options),
        path: { id: orderIdSchema.parse(id) },
      });
      return {
        id,
        cancellationRequested: true,
        message:
          "Cancellation was requested; the order may already be filling. Check pending orders and history.",
      };
    },
  };
  readonly reports = {
    list: (options?: RequestOptions) =>
      payload(sdk.getReports(this.options(options))),
    request: async (input: ReportInput, options?: RequestOptions) =>
      payload(
        sdk.requestReport({
          ...this.options(options),
          body: reportSchema.parse(input),
        }),
      ),
  };
  readonly history: HistoryMethods = {
    page: async (
      kind: HistoryKind,
      input: HistoryPageOptions = {},
      options?: RequestOptions,
    ): Promise<HistoryPage> => {
      historyKindSchema.parse(kind);
      const { nextPagePath, ...query } = historyPageSchema.parse(input);
      if (kind === "transactions" && query.ticker)
        throw new Error("Transactions do not support a ticker filter.");
      if (nextPagePath && Object.keys(query).length > 0)
        throw new Error(
          "Use nextPagePath alone to preserve pagination parameters.",
        );
      if (nextPagePath) {
        const validated = new URL(
          this.#transport.validatePath(
            nextPagePath,
            `/api/v0/equity/history/${kind}`,
          ),
        );
        const limits = validated.searchParams.getAll("limit");
        if (
          limits.length > 1 ||
          (limits.length === 1 &&
            !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limits[0] ?? ""))
        )
          throw new Error("Continuation limit must be between 1 and 50.");
        const url = `${validated.pathname}${validated.search}`;
        return payload(
          this.#http.get<{ 200: HistoryPage }, unknown, true>({
            url,
            throwOnError: true,
            ...options,
          }),
        );
      }
      switch (kind) {
        case "orders":
          return payload(sdk.orders1({ ...this.options(options), query }));
        case "dividends":
          return payload(sdk.dividends({ ...this.options(options), query }));
        case "transactions":
          return payload(
            sdk.transactions({
              ...this.options(options),
              query: { limit: query.limit },
            }),
          );
      }
    },
    pages: async function* (
      this: HistoryMethods,
      kind: HistoryKind,
      input: HistoryPageOptions & { maxPages?: number } = {},
      options?: RequestOptions,
    ): AsyncGenerator<HistoryPage> {
      const { maxPages = 10, ...firstPage } = input;
      z.number().int().min(1).max(100).parse(maxPages);
      const visited = new Set<string>();
      let next = firstPage;
      for (let index = 0; index < maxPages; index++) {
        const page = await this.page(kind, next, options);
        yield page;
        if (!page.nextPagePath) return;
        if (visited.has(page.nextPagePath))
          throw new Trading212Error(
            "INVALID_RESPONSE",
            "API returned a repeated pagination cursor.",
          );
        visited.add(page.nextPagePath);
        next = { nextPagePath: page.nextPagePath };
      }
    },
  };

  /** Deprecated upstream operations. Mutations still require allowTrading. */
  readonly deprecatedPies = {
    list: (options?: RequestOptions) =>
      payload(sdk.getAll(this.options(options))),
    get: (id: number, options?: RequestOptions) =>
      payload(
        sdk.getDetailed({
          ...this.options(options),
          path: { id: orderIdSchema.parse(id) },
        }),
      ),
    create: (body: PieRequest, options?: RequestOptions) =>
      payload(sdk.create({ ...this.options(options), body })),
    update: (id: number, body: PieRequest, options?: RequestOptions) =>
      payload(
        sdk.update({
          ...this.options(options),
          path: { id: orderIdSchema.parse(id) },
          body,
        }),
      ),
    duplicate: (
      id: number,
      body: DuplicateBucketRequest,
      options?: RequestOptions,
    ) =>
      payload(
        sdk.duplicatePie({
          ...this.options(options),
          path: { id: orderIdSchema.parse(id) },
          body,
        }),
      ),
    delete: async (id: number, options?: RequestOptions) => {
      await sdk.delete_({
        ...this.options(options),
        path: { id: orderIdSchema.parse(id) },
      });
    },
  };
}
