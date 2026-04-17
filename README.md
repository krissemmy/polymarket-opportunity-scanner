# Polymarket Opportunity Scanner

A small Next.js dashboard that scans active Polymarket binary markets for
**complete-set pricing edges** and ranks them by edge, top-of-book depth, and
spread tightness. Read-only. No wallet, no signing, no order execution.

Think of it as a heads-up display for "is a Yes + No basket mispriced right
now?" — not a trading system, not a backtester, not a predictor.

## What it actually does

1. Pulls active `enableOrderBook=true` markets from the public Gamma API.
2. Keeps only binary Yes/No markets that expose two CLOB token IDs.
3. Fetches top-of-book snapshots from the public CLOB `/books` endpoint.
4. Computes, per market:
   - `buy_edge  = 1 − (yesAsk + noAsk)`
   - `sell_edge = (yesBid + noBid) − 1`
   - dominant-side top size, spread, book freshness
5. Drops markets with wide spreads, thin tops, crossed books, or edges too far
   from parity to be interesting.
6. Ranks the rest, tags the dominant action (buy / sell), and assigns a
   confidence label — **never HIGH unless edge is positive**.
7. Serves everything from a single cached Next.js API route.

A positive buy edge means the YES-ask + NO-ask basket costs less than $1.00.
A positive sell edge means the YES-bid + NO-bid basket pays more than $1.00.
Real opportunities on liquid Polymarket markets are rare and short-lived — if
the scanner shows zero, that's usually correct, not broken.

## Architecture

```
app/page.tsx                 — shell
app/api/signals/route.ts     — single cached GET endpoint
components/signals-dashboard.tsx — polling client, toggle, table, reasoning
lib/polymarket.ts            — Gamma + CLOB fetch, market normalization, top-of-book
lib/scoring.ts               — edge math, filters, ranking, confidence
lib/types.ts                 — shared types
```

## Run it locally

```bash
npm install
npm run dev
# open http://localhost:3000
```

Type-check without emit:

```bash
npm run typecheck
```

## Environment knobs (all optional)

| Variable | Default | Meaning |
|---|---|---|
| `POLYMARKET_MARKET_LIMIT` | `120` | Max active markets scanned per refresh |
| `POLYMARKET_CACHE_TTL_MS` | `15000` | Server-side snapshot cache TTL |
| `POLYMARKET_MAX_SPREAD` | `0.25` | Drop markets with YES or NO spread wider than this |
| `POLYMARKET_MIN_TOP_LIQUIDITY` | `50` | Minimum size at dominant-side top of book (sets) |
| `POLYMARKET_MIN_EDGE` | `-0.005` | Drop candidates with dominant edge below this (noise floor) |
| `POLYMARKET_STALE_AFTER_MS` | `120000` | Mark book as stale beyond this age |

## Deploy on Vercel

1. Push this folder to a Git repo.
2. Import into Vercel with the default Next.js preset.
3. Add env knobs above only if you want to tune filters.
4. Deploy.

No database, no cron, no secrets. The single `/api/signals` route is
serverless-friendly and caches per-instance for `CACHE_TTL_MS`.

## What it deliberately doesn't do

- **No prediction.** Confidence is a heuristic on microstructure health, not
  forecasted profit.
- **No depth / fees.** Only top-of-book sizes and raw prices. Real fills slip
  the book; real platforms charge fees. Both are ignored.
- **No persistence.** In-memory cache only. Fine for single-instance hosting,
  imperfect across serverless cold starts.
- **No schema guarantees.** Polymarket's public responses can change shape.
  The parsing is defensive but not bulletproof — long-term use wants a schema
  validator and upstream tests.
- **No execution.** This is deliberately not a trading bot.

## What I'd build next

- Historical snapshots + alerting when an edge crosses some threshold.
- Deeper book walks and fee-aware PnL estimates.
- UI filters for category, end-date window, min liquidity.
- WebSocket CLOB feed for near-real-time updates.
- Upstream response validation (zod) + a tiny test suite over parsing / scoring.
