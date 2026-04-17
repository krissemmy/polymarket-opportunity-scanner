# Polymarket Opportunity Scanner

Read-only Next.js app that scans public Polymarket markets for complete-set pricing dislocations and ranks the ones worth looking at.

## TL;DR for reviewer

- Built as a fast MVP. I prioritized a working end-to-end slice and sensible product judgment over adding more surface area.
- Uses only public Polymarket data: Gamma for market discovery and CLOB for order book data.
- This is a signal bot, not a live trading system. No wallet auth, no signed orders, no execution.
- Zero opportunities is a valid result, not a bug. The UI is designed to say that clearly.
- The default view shows positive-edge opportunities only and hides extreme long-shot markets by default to reduce noise.

## Why this is useful

Polymarket exposes enough public data to answer a narrow but useful question:

“Is there any obvious complete-set edge worth looking at right now?”

This app is useful because it:

- turns raw order book snapshots into a ranked signal view
- filters out a lot of market-list noise
- makes “nothing interesting right now” explicit instead of pretending there is always a signal

## What it does

- Fetches active `enableOrderBook=true` markets from the public Gamma API
- Keeps only binary Yes/No markets with both outcome token IDs available
- Pulls public top-of-book data for both outcome tokens from the public CLOB API
- Computes buy-side and sell-side complete-set edges
- Filters out incomplete books and low-quality candidates
- Ranks the remaining markets by edge first, then top-of-book liquidity, then spread tightness
- Shows a compact dashboard with refresh, auto-refresh, summary cards, and an expandable reasoning drawer

## Why I built it this way

This project was meant to be a fast take-home style MVP, not a trading platform.

I deliberately kept the scope small:

- no database
- no cron
- no auth
- no websocket stack
- no background jobs
- no execution logic

That tradeoff let me spend time on the parts that matter more here:

- parsing real Polymarket responses instead of mocking data
- handling incomplete or noisy markets without breaking the UI
- making the “no opportunities right now” state feel intentional
- keeping the whole app deployable to Vercel with minimal setup

## How it works

1. The server route calls the public Gamma API and collects active markets.
2. It normalizes outcomes and token IDs, then keeps only real binary Yes/No order-book markets.
3. It fetches public order book snapshots for both outcome tokens from the CLOB API.
4. It extracts best bid, best ask, top-of-book size, spread, and book freshness.
5. It computes signals, applies ranking and filters, and returns one aggregated JSON payload.
6. The client dashboard polls that route every 25 seconds and renders the current snapshot.

Architecture is intentionally simple:

- `app/api/signals/route.ts`: aggregation route with light in-memory caching
- `lib/polymarket.ts`: Gamma/CLOB helpers and market normalization
- `lib/scoring.ts`: signal math, ranking, and filtering
- `components/signals-dashboard.tsx`: polling UI, filters, empty states, and details drawer
- `app/page.tsx`: page shell

## Signal logic

In plain English:

- If buying one YES and one NO costs less than `$1.00` total, that is a buy-side complete-set opportunity.
- If selling one YES and one NO would bring in more than `$1.00` total, that is a sell-side complete-set opportunity.
- If neither side is positive, the app can still show the market as a near-miss when you opt in, but it does not label it as an opportunity.

Formulas:

- `buy_complete_set_edge = 1 - (yesAsk + noAsk)`
- `sell_complete_set_edge = (yesBid + noBid) - 1`

Supporting metrics:

- `yes_spread = yesAsk - yesBid`
- `no_spread = noAsk - noBid`
- `buy_top_liquidity = min(yesAskSize, noAskSize)`
- `sell_top_liquidity = min(yesBidSize, noBidSize)`

Filters used to avoid junk and noise:

- non-binary markets are dropped
- markets missing token IDs are dropped
- books missing bids or asks are dropped
- invalid quotes are dropped
- very wide spreads are dropped
- thin top-of-book liquidity is dropped
- weak negative-edge candidates are dropped as noise
- extreme long-shot markets are hidden by default in the UI
- positive-edge-only view is on by default

## Product decisions / tradeoffs

- Read-only by design: this is a signal bot, not a live trading system.
- Public data only: no privileged APIs, no wallet connection, no signed orders.
- Top-of-book only: faster and simpler than modeling full depth, but less realistic for actual execution.
- Single aggregation route: keeps API quirks and parsing logic out of the client.
- Light in-memory caching: good enough for a Vercel MVP, not durable across serverless cold starts.
- Zero opportunities is a normal output. I chose to present that clearly instead of filling the screen with weak candidates by default.
- The default UI is opinionated: it prefers a smaller, more credible first impression over showing every market the backend can score.

## Local setup

Requirements:

- Node 20+ is enough
- no database
- no secrets required

Install and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Optional:

```bash
cp .env.example .env.local
npm run typecheck
npm run build
```

Optional tuning knobs:

- `POLYMARKET_MARKET_LIMIT`
- `POLYMARKET_CACHE_TTL_MS`
- `POLYMARKET_MAX_SPREAD`
- `POLYMARKET_MIN_TOP_LIQUIDITY`
- `POLYMARKET_MIN_EDGE`
- `POLYMARKET_STALE_AFTER_MS`

## Deploying to Vercel

1. Push the project to a Git repo.
2. Import it into Vercel as a Next.js project.
3. Add optional env vars only if you want to tune filters.
4. Deploy.

Notes:

- no database setup
- no scheduled jobs
- no wallet or private keys
- works as a single Next.js app with one dynamic API route

## Limitations

- Uses top-of-book data only, not deeper order book walks.
- Does not model fees, slippage, or execution constraints.
- Does not persist snapshots or provide history.
- In-memory caching is per instance, so behavior can vary across cold starts.
- Polymarket response shapes can change; parsing is defensive but not fully schema-validated.
- The market scan is capped for speed, so this is not a full crawl of every active market on every refresh.
- Confidence is a heuristic about quote quality and context, not predicted profitability.

## What I’d build next

- historical snapshots and simple alerts
- fee-aware and depth-aware profitability checks
- category and search filters
- parser and scoring tests around edge cases
- shareable URLs for the active filters

## If I had more time

I would harden the data layer and narrow signal quality further:

- add explicit schema validation around upstream Polymarket responses
- separate normalization tests from ranking tests
- add a websocket path for faster updates
- move more of the UI filters into the API layer so snapshots are easier to compare and share
