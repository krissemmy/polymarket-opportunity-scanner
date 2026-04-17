import type {
  ConfidenceLabel,
  MarketCandidate,
  OrderBookSummary,
  Signal,
  SignalsResponse,
  TopOfBookQuote,
} from "@/lib/types";
import { getTopOfBook } from "@/lib/polymarket";

export type ScannerFilters = {
  maxSpread: number;
  minTopLiquidity: number;
  staleAfterMs: number;
  /**
   * Minimum dominant edge (in absolute, e.g. -0.005 = -0.5%) for a market to be
   * shown as a candidate. Values below this threshold are dropped as noise.
   */
  minEdge: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getConfidenceLabel(score: number): ConfidenceLabel {
  if (score >= 72) return "high";
  if (score >= 48) return "medium";
  return "low";
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatCents(value: number) {
  return `${(value * 100).toFixed(1)}c`;
}

function formatSets(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function isoFromTimestamp(timestampMs: number | null, fallbackIso: string) {
  if (timestampMs === null) return fallbackIso;
  return new Date(timestampMs).toISOString();
}

function roundEdge(value: number) {
  // Round to 4 decimal places to clean up FP noise like -0.00099999...
  return Math.round(value * 10_000) / 10_000;
}

function buildReasoning(signal: Signal, dataAgeMs: number): string[] {
  const confidenceReasons: string[] = [];

  if (!signal.isOpportunity) {
    confidenceReasons.push("dominant edge is not positive");
  }

  if (signal.combinedSpread <= 0.04) {
    confidenceReasons.push("combined spread is tight");
  } else if (signal.combinedSpread <= 0.1) {
    confidenceReasons.push("combined spread is workable");
  } else {
    confidenceReasons.push("combined spread is wide");
  }

  if (signal.dominantTopLiquidity >= 500) {
    confidenceReasons.push("dominant-side top size is solid");
  } else if (signal.dominantTopLiquidity >= 100) {
    confidenceReasons.push("dominant-side top size is usable");
  } else {
    confidenceReasons.push("dominant-side top size is thin");
  }

  if (dataAgeMs <= 30_000) {
    confidenceReasons.push("book data is fresh");
  } else if (dataAgeMs <= 90_000) {
    confidenceReasons.push("book data is aging");
  } else {
    confidenceReasons.push("book data is stale");
  }

  return [
    `Buy complete-set edge is ${formatPercent(signal.buyCompleteSetEdge)} (YES ask ${formatCents(signal.yes.bestAsk)} + NO ask ${formatCents(signal.no.bestAsk)} = ${formatCents(signal.yes.bestAsk + signal.no.bestAsk)}).`,
    `Sell complete-set edge is ${formatPercent(signal.sellCompleteSetEdge)} (YES bid ${formatCents(signal.yes.bestBid)} + NO bid ${formatCents(signal.no.bestBid)} = ${formatCents(signal.yes.bestBid + signal.no.bestBid)}).`,
    `Top-of-book supports about ${formatSets(signal.buyTopLiquidity)} sets on the buy side, ${formatSets(signal.sellTopLiquidity)} on the sell side.`,
    `Spreads: YES ${formatCents(signal.yes.spread)}, NO ${formatCents(signal.no.spread)}, combined ${formatCents(signal.combinedSpread)}.`,
    signal.isOpportunity
      ? `Dominant edge is positive, so this clears the opportunity threshold.`
      : `Dominant edge is not positive — shown as a near-miss for context, not as a tradable opportunity.`,
    `Confidence is ${signal.confidence.toUpperCase()} (${confidenceReasons.join("; ")}).`,
  ];
}

function scoreSignal(
  market: MarketCandidate,
  yes: TopOfBookQuote,
  no: TopOfBookQuote,
  filters: ScannerFilters,
  generatedAt: string,
): Signal | null {
  // Price-sanity: binary market prices must be in (0, 1) and spreads non-negative.
  if (
    yes.bestBid <= 0 ||
    yes.bestAsk <= 0 ||
    no.bestBid <= 0 ||
    no.bestAsk <= 0 ||
    yes.bestBid >= 1 ||
    yes.bestAsk > 1 ||
    no.bestBid >= 1 ||
    no.bestAsk > 1 ||
    yes.spread < 0 ||
    no.spread < 0
  ) {
    return null;
  }

  const maxSpread = Math.max(yes.spread, no.spread);
  if (maxSpread > filters.maxSpread) {
    return null;
  }

  const buyCompleteSetEdge = roundEdge(1 - (yes.bestAsk + no.bestAsk));
  const sellCompleteSetEdge = roundEdge(yes.bestBid + no.bestBid - 1);
  const buyTopLiquidity = Math.min(yes.bestAskSize, no.bestAskSize);
  const sellTopLiquidity = Math.min(yes.bestBidSize, no.bestBidSize);

  const dominantAction: "buy" | "sell" =
    buyCompleteSetEdge >= sellCompleteSetEdge ? "buy" : "sell";
  const dominantEdge =
    dominantAction === "buy" ? buyCompleteSetEdge : sellCompleteSetEdge;
  const dominantTopLiquidity =
    dominantAction === "buy" ? buyTopLiquidity : sellTopLiquidity;

  // Drop candidates whose dominant side is too thin to matter.
  if (dominantTopLiquidity < filters.minTopLiquidity) {
    return null;
  }

  // Drop candidates that are structurally too far from parity to be interesting.
  if (dominantEdge < filters.minEdge) {
    return null;
  }

  const bookTimestampMs = Math.min(
    yes.bookTimestampMs ?? Number.POSITIVE_INFINITY,
    no.bookTimestampMs ?? Number.POSITIVE_INFINITY,
  );
  const hasFiniteTimestamp = Number.isFinite(bookTimestampMs);
  const dataAgeMs = hasFiniteTimestamp
    ? Math.max(0, Date.now() - bookTimestampMs)
    : filters.staleAfterMs + 1;
  const stale = dataAgeMs > filters.staleAfterMs;
  const combinedSpread = yes.spread + no.spread;
  const isOpportunity = dominantEdge > 0;

  // Confidence: reward positive edge, freshness, and dominant-side depth;
  // penalize wide combined spread and staleness. Non-opportunities are capped
  // at "low" so the badge reflects opportunity quality, not book tightness.
  let confidenceScore = 40;
  confidenceScore += clamp(dominantEdge * 900, 0, 28);
  confidenceScore += clamp(Math.log10(dominantTopLiquidity + 1) * 9, 0, 22);
  confidenceScore -= clamp(combinedSpread * 180, 0, 34);
  if (stale) confidenceScore -= 18;
  if (!isOpportunity) {
    // Near-misses can never be "high" confidence — cap below the medium threshold.
    confidenceScore = Math.min(confidenceScore, 34);
  }
  confidenceScore = clamp(confidenceScore, 0, 100);

  const signal: Signal = {
    marketId: market.id,
    question: market.question,
    slug: market.slug,
    yes,
    no,
    isOpportunity,
    buyCompleteSetEdge,
    sellCompleteSetEdge,
    buyTopLiquidity,
    sellTopLiquidity,
    dominantAction,
    dominantEdge,
    dominantTopLiquidity,
    combinedSpread,
    confidence: getConfidenceLabel(confidenceScore),
    confidenceScore: Math.round(confidenceScore * 10) / 10,
    stale,
    lastUpdated: isoFromTimestamp(
      hasFiniteTimestamp ? bookTimestampMs : null,
      market.updatedAt ?? generatedAt,
    ),
    reasoning: [],
  };

  signal.reasoning = buildReasoning(signal, dataAgeMs);
  return signal;
}

function compareSignals(left: Signal, right: Signal) {
  // Opportunities always come before near-misses.
  if (left.isOpportunity !== right.isOpportunity) {
    return left.isOpportunity ? -1 : 1;
  }
  if (right.dominantEdge !== left.dominantEdge) {
    return right.dominantEdge - left.dominantEdge;
  }
  if (right.dominantTopLiquidity !== left.dominantTopLiquidity) {
    return right.dominantTopLiquidity - left.dominantTopLiquidity;
  }
  if (left.combinedSpread !== right.combinedSpread) {
    return left.combinedSpread - right.combinedSpread;
  }
  return right.confidenceScore - left.confidenceScore;
}

export function buildSignalsResponse(
  markets: MarketCandidate[],
  booksByTokenId: Map<string, OrderBookSummary>,
  filters: ScannerFilters,
): SignalsResponse {
  const generatedAt = new Date().toISOString();
  const signals: Signal[] = [];
  let evaluatedMarkets = 0;
  let skippedIncomplete = 0;

  for (const market of markets) {
    const yesTop = getTopOfBook(booksByTokenId.get(market.yesTokenId));
    const noTop = getTopOfBook(booksByTokenId.get(market.noTokenId));

    if (!yesTop || !noTop) {
      skippedIncomplete += 1;
      continue;
    }

    evaluatedMarkets += 1;

    const signal = scoreSignal(market, yesTop, noTop, filters, generatedAt);
    if (signal) {
      signals.push(signal);
    }
  }

  signals.sort(compareSignals);

  // "Best" means best *positive* edge. Negative maxima are not reported — a
  // scan with no positive edges should show "—" in the UI, not a negative %.
  const positiveBuyEdges = signals
    .map((s) => s.buyCompleteSetEdge)
    .filter((e) => e > 0);
  const positiveSellEdges = signals
    .map((s) => s.sellCompleteSetEdge)
    .filter((e) => e > 0);

  return {
    generatedAt,
    scannedMarkets: markets.length,
    evaluatedMarkets,
    skippedIncomplete,
    opportunitiesFound: signals.filter((signal) => signal.isOpportunity).length,
    bestBuyEdge: positiveBuyEdges.length > 0 ? Math.max(...positiveBuyEdges) : null,
    bestSellEdge: positiveSellEdges.length > 0 ? Math.max(...positiveSellEdges) : null,
    signals,
  };
}
