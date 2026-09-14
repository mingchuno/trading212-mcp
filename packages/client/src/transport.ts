import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { Trading212Error } from "./errors.js";

export const environmentSchema = z.enum(["live", "demo"]);
export type Environment = z.infer<typeof environmentSchema>;
export type Fetch = (request: Request) => Promise<Response>;
export interface ClientConfig {
  environment: Environment;
  apiKey: string;
  apiSecret: string;
  allowTrading?: boolean;
  fetch?: Fetch;
  timeoutMs?: number;
  maxWaitMs?: number;
  readRetries?: number;
}

// Conservative pacing from the pinned specification, keyed by method and endpoint.
function intervalMs(method: string, path: string): number {
  if (path.endsWith("/metadata/instruments")) return 50_000;
  if (path.endsWith("/metadata/exchanges")) return 30_000;
  if (path.endsWith("/history/exports"))
    return method === "GET" ? 60_000 : 30_000;
  if (path.includes("/history/")) return 10_000;
  if (path.endsWith("/account/summary") || path.endsWith("/orders"))
    return 5_000;
  if (path.endsWith("/positions")) return 1_000;
  if (path.includes("/pies"))
    return path.endsWith("/pies") && method === "GET" ? 30_000 : 5_000;
  if (/\/orders\/(limit|stop|stop_limit)$/.test(path)) return 2_000;
  return method === "GET" ? 1_000 : 1_200;
}

function retryDelay(headers: Headers): number {
  const retry = headers.get("retry-after");
  const reset = headers.get("x-ratelimit-reset");
  const seconds = retry === null ? Number.NaN : Number(retry);
  const retryMs = Number.isFinite(seconds)
    ? seconds * 1000
    : retry
      ? Date.parse(retry) - Date.now()
      : 0;
  const resetMs = reset === null ? 0 : Number(reset) * 1000 - Date.now();
  return Math.max(
    0,
    Number.isFinite(retryMs) ? retryMs : 0,
    Number.isFinite(resetMs) ? resetMs : 0,
  );
}

function httpError(response: Response, mutation: boolean): Trading212Error {
  const { status } = response;
  if (
    mutation &&
    (status >= 500 || status === 408 || (status >= 300 && status < 400))
  ) {
    return new Trading212Error(
      "OUTCOME_UNKNOWN",
      "Request may have been applied. Inspect pending orders and history before taking further action; do not resubmit automatically.",
      status,
    );
  }
  if (status === 401)
    return new Trading212Error(
      "AUTHENTICATION_FAILED",
      "Check the API key, secret, and selected environment.",
      status,
    );
  if (status === 403)
    return new Trading212Error(
      "PERMISSION_DENIED",
      "Check API-key permissions and IP restrictions.",
      status,
    );
  if (status === 429)
    return new Trading212Error(
      "RATE_LIMITED",
      "Account rate limit reached.",
      status,
      retryDelay(response.headers),
    );
  return new Trading212Error(
    "API_ERROR",
    `Trading 212 rejected the request (HTTP ${status}).`,
    status,
  );
}

export class Transport {
  readonly origin: string;
  readonly environment: Environment;
  readonly allowTrading: boolean;
  readonly #authorization: string;
  readonly #fetch: Fetch;
  readonly #timeoutMs: number;
  readonly #maxWaitMs: number;
  readonly #readRetries: number;
  readonly #nextAllowed = new Map<string, number>();
  readonly #queues = new Map<string, Promise<void>>();

  constructor(config: ClientConfig) {
    this.environment = environmentSchema.parse(config.environment);
    this.origin = `https://${this.environment}.trading212.com`;
    const key = z
      .string()
      .min(1)
      .refine((value) => !/[:\r\n]/.test(value), "Invalid API key")
      .parse(config.apiKey);
    const secret = z
      .string()
      .min(1)
      .refine((value) => !/[\r\n]/.test(value), "Invalid API secret")
      .parse(config.apiSecret);
    this.#authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
    this.allowTrading = z.boolean().parse(config.allowTrading ?? false);
    this.#fetch = config.fetch ?? fetch;
    this.#timeoutMs = z
      .number()
      .int()
      .min(1)
      .max(120_000)
      .parse(config.timeoutMs ?? 15_000);
    this.#maxWaitMs = z
      .number()
      .int()
      .min(0)
      .max(60_000)
      .parse(config.maxWaitMs ?? 5_000);
    this.#readRetries = z
      .number()
      .int()
      .min(0)
      .max(3)
      .parse(config.readRetries ?? 1);
  }

  assertTradingAllowed() {
    if (!this.allowTrading)
      throw new Trading212Error(
        "TRADING_DISABLED",
        "Trading is disabled. Enable it in server configuration, outside tool arguments.",
      );
  }

  validatePath(path: string, expectedPath?: string): string {
    const url = new URL(path, this.origin);
    if (
      url.origin !== this.origin ||
      url.username ||
      url.password ||
      url.hash ||
      !url.pathname.startsWith("/api/v0/equity/") ||
      (expectedPath && url.pathname !== expectedPath)
    ) {
      throw new Trading212Error(
        "INVALID_PATH",
        "Only the selected Trading 212 origin and expected API endpoint are allowed.",
      );
    }
    return url.href;
  }

  fetch: typeof fetch = async (input, init) => {
    const incoming = new Request(input, init);
    this.validatePath(incoming.url);
    const path = new URL(incoming.url).pathname;
    const mutation = incoming.method !== "GET";
    if (mutation && !path.endsWith("/history/exports"))
      this.assertTradingAllowed();
    const key = `${incoming.method} ${path.replace(/\/\d+(?=\/|$)/g, "/{id}")}`;
    const deadline = Date.now() + this.#maxWaitMs;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const operation = this.awaitTurn(previous, incoming.signal, deadline).then(
      () => this.send(incoming, key, deadline),
    );
    const settled = operation.then(
      () => {},
      () => {},
    );
    // A cancelled waiter must not let later requests overtake the active request.
    const tail = previous.then(() => settled);
    this.#queues.set(key, tail);
    void tail.then(() => {
      if (this.#queues.get(key) === tail) this.#queues.delete(key);
    });
    return operation;
  };

  private awaitTurn(
    previous: Promise<void>,
    signal: AbortSignal,
    deadline: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () =>
        finish(
          new Trading212Error(
            "CANCELLED",
            "Request cancelled before submission.",
          ),
        );
      const timer = setTimeout(
        () =>
          finish(
            new Trading212Error(
              "RATE_LIMITED",
              "Request queue wait exceeds the configured budget.",
            ),
          ),
        Math.max(0, deadline - Date.now()),
      );
      function finish(error?: Trading212Error) {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      }
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      else void previous.then(() => finish());
    });
  }

  private async waitForBudget(
    key: string,
    deadline: number,
    signal: AbortSignal,
  ) {
    if (signal.aborted)
      throw new Trading212Error(
        "CANCELLED",
        "Request cancelled before submission.",
      );
    const delay = Math.max(0, (this.#nextAllowed.get(key) ?? 0) - Date.now());
    if (delay > 0 && Date.now() + delay > deadline)
      throw new Trading212Error(
        "RATE_LIMITED",
        "Rate-limit wait exceeds the configured budget.",
        undefined,
        delay,
      );
    if (delay > 0) {
      try {
        await sleep(delay, undefined, { signal });
      } catch {
        throw new Trading212Error(
          "CANCELLED",
          "Request cancelled before submission.",
        );
      }
    }
  }

  private async send(
    incoming: Request,
    key: string,
    deadline: number,
  ): Promise<Response> {
    const mutation = incoming.method !== "GET";
    const path = new URL(incoming.url).pathname;
    for (let attempt = 0; ; attempt++) {
      await this.waitForBudget(key, deadline, incoming.signal);
      this.#nextAllowed.set(
        key,
        Date.now() + intervalMs(incoming.method, path),
      );
      const headers = new Headers(incoming.headers);
      headers.set("Authorization", this.#authorization);
      headers.set("Accept", "application/json");
      const request = new Request(incoming.clone(), {
        headers,
        redirect: "error",
        signal: AbortSignal.any([
          incoming.signal,
          AbortSignal.timeout(this.#timeoutMs),
        ]),
      });
      try {
        const response = await this.#fetch(request);
        if (
          response.headers.get("x-ratelimit-remaining") === "0" ||
          response.status === 429
        ) {
          this.#nextAllowed.set(
            key,
            Math.max(
              this.#nextAllowed.get(key) ?? 0,
              Date.now() + retryDelay(response.headers),
            ),
          );
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw httpError(response, mutation);
        }
        // Consume under the request timeout; keep parsing failures inside mutation uncertainty handling.
        const body = await response.text();
        if (body) JSON.parse(body);
        return new Response(body || null, {
          status: response.status,
          headers: response.headers,
        });
      } catch (error) {
        const failure =
          error instanceof Trading212Error
            ? error
            : new Trading212Error(
                mutation
                  ? "OUTCOME_UNKNOWN"
                  : incoming.signal.aborted
                    ? "CANCELLED"
                    : error instanceof SyntaxError
                      ? "INVALID_RESPONSE"
                      : "NETWORK_ERROR",
                mutation
                  ? "Request may have been applied. Inspect pending orders and history; do not resubmit automatically."
                  : "Request failed or returned an invalid response.",
              );
        const retryable =
          failure.code === "RATE_LIMITED" ||
          failure.code === "NETWORK_ERROR" ||
          (failure.status ?? 0) >= 500;
        if (mutation || !retryable || attempt >= this.#readRetries)
          throw failure;
        if ((this.#nextAllowed.get(key) ?? 0) > deadline) throw failure;
      }
    }
  }
}
