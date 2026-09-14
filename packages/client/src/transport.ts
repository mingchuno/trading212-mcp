import { z } from "zod";
import { Trading212Error } from "./errors.js";
import { RequestScheduler, retryDelay } from "./scheduler.js";

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

function requestFailure(error: unknown, incoming: Request): Trading212Error {
  const mutation = incoming.method !== "GET";
  return error instanceof Trading212Error
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
}

export class Transport {
  readonly origin: string;
  readonly environment: Environment;
  readonly allowTrading: boolean;
  readonly #authorization: string;
  readonly #fetch: Fetch;
  readonly #timeoutMs: number;
  readonly #scheduler: RequestScheduler;
  readonly #readRetries: number;

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
    const maxWaitMs = z
      .number()
      .int()
      .min(0)
      .max(60_000)
      .parse(config.maxWaitMs ?? 5_000);
    this.#scheduler = new RequestScheduler(maxWaitMs);
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
    return this.#scheduler.schedule(incoming, (key, deadline) =>
      this.send(incoming, key, deadline),
    );
  };

  private authorizedRequest(incoming: Request): Request {
    const headers = new Headers(incoming.headers);
    headers.set("Authorization", this.#authorization);
    headers.set("Accept", "application/json");
    return new Request(incoming.clone(), {
      headers,
      redirect: "error",
      signal: AbortSignal.any([
        incoming.signal,
        AbortSignal.timeout(this.#timeoutMs),
      ]),
    });
  }

  private async sendAttempt(request: Request, key: string): Promise<Response> {
    const response = await this.#fetch(request);
    this.#scheduler.observeResponse(key, response);
    if (!response.ok) {
      await response.body?.cancel();
      throw httpError(response, request.method !== "GET");
    }
    // Consume under the request timeout; keep parsing failures inside mutation uncertainty handling.
    const body = await response.text();
    if (body) JSON.parse(body);
    return new Response(body || null, {
      status: response.status,
      headers: response.headers,
    });
  }

  private async send(
    incoming: Request,
    key: string,
    deadline: number,
  ): Promise<Response> {
    const mutation = incoming.method !== "GET";
    for (let attempt = 0; ; attempt++) {
      await this.#scheduler.waitForBudget(key, deadline, incoming.signal);
      this.#scheduler.recordAttempt(key, incoming);
      const request = this.authorizedRequest(incoming);
      try {
        return await this.sendAttempt(request, key);
      } catch (error) {
        const failure = requestFailure(error, incoming);
        const retryable =
          failure.code === "RATE_LIMITED" ||
          failure.code === "NETWORK_ERROR" ||
          (failure.status ?? 0) >= 500;
        if (mutation || !retryable || attempt >= this.#readRetries)
          throw failure;
        if (this.#scheduler.exceedsDeadline(key, deadline)) throw failure;
      }
    }
  }
}
