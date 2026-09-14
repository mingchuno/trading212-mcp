# @mingchuno/trading212-client

Node.js 22.18+ ESM client for the Trading 212 public API. Independent community project; not affiliated with Trading 212.

## Install

```sh
npm install @mingchuno/trading212-client
# Or: pnpm add @mingchuno/trading212-client
```

Generate an API key and secret in Trading 212 for the environment you intend to use. Supply `T212_API_KEY` and `T212_API_SECRET` through your shell or secret manager; the library does not load `.env` files. Never include credentials in source control. [API-key instructions](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key).

## Read account data

```ts
import { Trading212Client } from '@mingchuno/trading212-client';

const client = new Trading212Client({
  environment: 'demo',
  apiKey: process.env.T212_API_KEY!,
  apiSecret: process.env.T212_API_SECRET!,
});
const summary = await client.account.summary();
const instruments = await client.instruments.search('Apple', 10);
const page = await client.history.page('orders', { limit: 20 });
```

## API and pagination

Namespaces: `account`, `positions`, `instruments`, `exchanges`, `orders`, `history`, `reports`, `deprecatedPies`. Methods accept a final `{ signal }` option. `history.pages(kind, { maxPages: 10 })` is a bounded async iterator; the final yielded page retains continuation information when the bound is reached. Rate limits can interrupt iteration; use the last continuation to resume.

## Trading and errors

Set `allowTrading: true` to enable order placement/cancellation and deprecated Pie mutations. Report requests remain available with trading disabled. `orders.place` accepts a discriminated order type, positive quantity, and explicit `buy`/`sell` side. Limits/stops require their price fields and `timeValidity` (`DAY` or `GOOD_TILL_CANCEL`).

`Trading212Error` exposes `code`, `status`, and optional `retryAfterMs`. No mutations are retried. `OUTCOME_UNKNOWN` requires reconciliation, not automatic resubmission. Cancellation success means only that cancellation was requested.

## Configuration

Optional configuration: `fetch`, `timeoutMs` (15000), `maxWaitMs` (5000), `readRetries` (1). Requests use the fixed selected broker origin. Rate scheduling and caches are per instance; broker limits are per account across all clients. Metadata cache misses share one request/signal.

Generated types are exported from the package root. `@mingchuno/trading212-client/generated` exports low-level generated functions without the maintained client's safeguards. Prefer the maintained client. [API documentation](https://docs.trading212.com/api).

## License

MIT. See the included `LICENCE` file.
