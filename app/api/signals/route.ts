import { NextResponse } from "next/server";
import {
  fetchActiveBinaryMarkets,
  fetchOrderBooksForTokenIds,
  getScannerMarketLimit,
} from "@/lib/polymarket";
import { buildSignalsResponse } from "@/lib/scoring";
import type { SignalsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CACHE_TTL_MS = 15_000;
const DEFAULT_MAX_SPREAD = 0.25;
const DEFAULT_MIN_TOP_LIQUIDITY = 50;
const DEFAULT_STALE_AFTER_MS = 120_000;
const DEFAULT_MIN_EDGE = -0.005; // show candidates within 0.5% of parity

type CachedSnapshot = {
  payload: SignalsResponse;
  createdAt: number;
};

let cached: CachedSnapshot | null = null;
let cacheExpiresAt = 0;
let inFlight: Promise<SignalsResponse> | null = null;

function getPositiveEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getSignedEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

async function buildSnapshot(): Promise<SignalsResponse> {
  const markets = await fetchActiveBinaryMarkets(getScannerMarketLimit());
  const tokenIds = Array.from(
    new Set(markets.flatMap((market) => [market.yesTokenId, market.noTokenId])),
  );
  const booksByTokenId = await fetchOrderBooksForTokenIds(tokenIds);

  return buildSignalsResponse(markets, booksByTokenId, {
    maxSpread: getPositiveEnv("POLYMARKET_MAX_SPREAD", DEFAULT_MAX_SPREAD),
    minTopLiquidity: getPositiveEnv(
      "POLYMARKET_MIN_TOP_LIQUIDITY",
      DEFAULT_MIN_TOP_LIQUIDITY,
    ),
    staleAfterMs: getPositiveEnv(
      "POLYMARKET_STALE_AFTER_MS",
      DEFAULT_STALE_AFTER_MS,
    ),
    minEdge: getSignedEnv("POLYMARKET_MIN_EDGE", DEFAULT_MIN_EDGE),
  });
}

export async function GET() {
  const now = Date.now();
  const cacheTtlMs = getPositiveEnv(
    "POLYMARKET_CACHE_TTL_MS",
    DEFAULT_CACHE_TTL_MS,
  );

  if (cached && now < cacheExpiresAt) {
    return NextResponse.json(cached.payload, { headers: NO_STORE_HEADERS });
  }

  if (!inFlight) {
    inFlight = buildSnapshot()
      .then((snapshot) => {
        cached = { payload: snapshot, createdAt: Date.now() };
        cacheExpiresAt = Date.now() + cacheTtlMs;
        return snapshot;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  try {
    const response = await inFlight;
    return NextResponse.json(response, { headers: NO_STORE_HEADERS });
  } catch (error) {
    // On failure, fall back to the most recent good snapshot — tagged so the
    // client can surface a "serving cached data" notice without swallowing the
    // error entirely.
    if (cached) {
      const stale: SignalsResponse = {
        ...cached.payload,
        servedFromCache: true,
        cacheAgeMs: Date.now() - cached.createdAt,
      };
      return NextResponse.json(stale, { headers: NO_STORE_HEADERS });
    }

    const message =
      error instanceof Error
        ? error.message
        : "Failed to build Polymarket signal snapshot.";

    return NextResponse.json(
      { error: message },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
