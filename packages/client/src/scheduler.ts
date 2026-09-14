import { setTimeout as sleep } from "node:timers/promises";
import { Trading212Error } from "./errors.js";

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

export function retryDelay(headers: Headers): number {
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

// Per-client scheduling; retries retain their original queue slot and deadline.
export class RequestScheduler {
  readonly #nextAllowed = new Map<string, number>();
  readonly #queues = new Map<string, Promise<void>>();

  constructor(private readonly maxWaitMs: number) {}

  schedule<T>(
    incoming: Request,
    send: (key: string, deadline: number) => Promise<T>,
  ): Promise<T> {
    const path = new URL(incoming.url).pathname;
    const key = `${incoming.method} ${path.replace(/\/\d+(?=\/|$)/g, "/{id}")}`;
    const deadline = Date.now() + this.maxWaitMs;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const operation = this.awaitTurn(previous, incoming.signal, deadline).then(
      () => send(key, deadline),
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
  }

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

  async waitForBudget(key: string, deadline: number, signal: AbortSignal) {
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

  recordAttempt(key: string, request: Request) {
    this.#nextAllowed.set(
      key,
      Date.now() + intervalMs(request.method, new URL(request.url).pathname),
    );
  }

  observeResponse(key: string, response: Response) {
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
  }

  exceedsDeadline(key: string, deadline: number): boolean {
    return (this.#nextAllowed.get(key) ?? 0) > deadline;
  }
}
