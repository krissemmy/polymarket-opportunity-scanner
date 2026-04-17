import type {
  GammaMarketRaw,
  MarketCandidate,
  OrderBookLevel,
  OrderBookSummary,
  TopOfBookQuote,
} from "@/lib/types";

const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const CLOB_BASE_URL = "https://clob.polymarket.com";
const DEFAULT_MARKET_LIMIT = 120;
const GAMMA_PAGE_SIZE = 100;
const MAX_GAMMA_PAGES = 3;
const BOOK_CHUNK_SIZE = 200;
const REQUEST_TIMEOUT_MS = 10_000;

function parseStringArray(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value !== "string" || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
  } catch {
    // fall through to comma-split fallback
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Polymarket request failed (${response.status}) for ${url}`);
  }

  return (await response.json()) as T;
}

function normalizeMarket(raw: GammaMarketRaw): MarketCandidate | null {
  if (!raw.active || raw.closed || raw.archived || !raw.enableOrderBook) {
    return null;
  }

  const outcomes = parseStringArray(raw.outcomes);
  const tokenIds = parseStringArray(raw.clobTokenIds);

  if (outcomes.length !== 2 || tokenIds.length !== 2) {
    return null;
  }

  const lowerOutcomes = outcomes.map((item) => item.toLowerCase());
  const yesIndex = lowerOutcomes.indexOf("yes");
  const noIndex = lowerOutcomes.indexOf("no");

  if (yesIndex === -1 || noIndex === -1 || yesIndex === noIndex) {
    return null;
  }

  const yesTokenId = tokenIds[yesIndex];
  const noTokenId = tokenIds[noIndex];

  if (!yesTokenId || !noTokenId) {
    return null;
  }

  return {
    id: raw.id,
    question: raw.question,
    slug: raw.slug,
    liquidity: toFiniteNumber(raw.liquidityNum ?? raw.liquidity, 0),
    updatedAt: raw.updatedAt,
    yesTokenId,
    noTokenId,
  };
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function normalizeLevel(level: OrderBookLevel) {
  return {
    price: Number(level.price),
    size: Number(level.size),
  };
}

function parseTimestampMs(value: string | undefined) {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }

  const dateValue = Date.parse(value);
  return Number.isNaN(dateValue) ? null : dateValue;
}

export function getScannerMarketLimit() {
  const parsed = Number(process.env.POLYMARKET_MARKET_LIMIT ?? DEFAULT_MARKET_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MARKET_LIMIT;
  }

  return Math.min(Math.floor(parsed), GAMMA_PAGE_SIZE * MAX_GAMMA_PAGES);
}

export async function fetchActiveBinaryMarkets(limit = getScannerMarketLimit()) {
  const discovered = new Map<string, MarketCandidate>();

  for (let page = 0; page < MAX_GAMMA_PAGES; page += 1) {
    if (discovered.size >= limit) {
      break;
    }

    const searchParams = new URLSearchParams({
      active: "true",
      closed: "false",
      archived: "false",
      enableOrderBook: "true",
      order: "volume_24hr",
      ascending: "false",
      limit: String(GAMMA_PAGE_SIZE),
      offset: String(page * GAMMA_PAGE_SIZE),
    });

    const url = `${GAMMA_BASE_URL}/markets?${searchParams.toString()}`;
    const markets = await fetchJson<GammaMarketRaw[]>(url);

    for (const market of markets) {
      const normalized = normalizeMarket(market);
      if (normalized && !discovered.has(normalized.id)) {
        discovered.set(normalized.id, normalized);
      }
    }

    if (markets.length < GAMMA_PAGE_SIZE) {
      break;
    }
  }

  return Array.from(discovered.values())
    .sort((left, right) => right.liquidity - left.liquidity)
    .slice(0, limit);
}

export async function fetchOrderBooksForTokenIds(tokenIds: string[]) {
  const booksByTokenId = new Map<string, OrderBookSummary>();
  if (tokenIds.length === 0) return booksByTokenId;

  const chunks = chunkArray(tokenIds, BOOK_CHUNK_SIZE);

  for (const chunk of chunks) {
    const books = await fetchJson<OrderBookSummary[]>(`${CLOB_BASE_URL}/books`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunk.map((tokenId) => ({ token_id: tokenId }))),
    });

    for (const book of books) {
      if (book?.asset_id) {
        booksByTokenId.set(book.asset_id, book);
      }
    }
  }

  return booksByTokenId;
}

export function getTopOfBook(book: OrderBookSummary | undefined): TopOfBookQuote | null {
  if (!book || !book.bids?.length || !book.asks?.length) {
    return null;
  }

  const bids = book.bids
    .map(normalizeLevel)
    .filter(
      (level) =>
        Number.isFinite(level.price) &&
        Number.isFinite(level.size) &&
        level.size > 0 &&
        level.price > 0 &&
        level.price < 1,
    );

  const asks = book.asks
    .map(normalizeLevel)
    .filter(
      (level) =>
        Number.isFinite(level.price) &&
        Number.isFinite(level.size) &&
        level.size > 0 &&
        level.price > 0 &&
        level.price <= 1,
    );

  if (bids.length === 0 || asks.length === 0) {
    return null;
  }

  const bestBid = bids.reduce((best, level) =>
    level.price > best.price ? level : best,
  );
  const bestAsk = asks.reduce((best, level) =>
    level.price < best.price ? level : best,
  );

  // Sanity: reject crossed books (bid >= ask indicates stale/inconsistent snapshot)
  if (bestBid.price >= bestAsk.price) {
    return null;
  }

  return {
    bestBid: bestBid.price,
    bestAsk: bestAsk.price,
    bestBidSize: bestBid.size,
    bestAskSize: bestAsk.size,
    spread: bestAsk.price - bestBid.price,
    bookTimestampMs: parseTimestampMs(book.timestamp),
  };
}
