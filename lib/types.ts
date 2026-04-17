export type GammaMarketRaw = {
  id: string;
  question: string;
  slug?: string;
  active: boolean;
  closed: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  outcomes?: string | string[] | null;
  clobTokenIds?: string | string[] | null;
  liquidity?: string | number;
  liquidityNum?: number;
  updatedAt?: string;
};

export type MarketCandidate = {
  id: string;
  question: string;
  slug?: string;
  liquidity: number;
  updatedAt?: string;
  yesTokenId: string;
  noTokenId: string;
};

export type OrderBookLevel = {
  price: string;
  size: string;
};

export type OrderBookSummary = {
  market: string;
  asset_id: string;
  timestamp: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  min_order_size?: string;
  tick_size?: string;
  neg_risk?: boolean;
  last_trade_price?: string;
};

export type TopOfBookQuote = {
  bestBid: number;
  bestAsk: number;
  bestBidSize: number;
  bestAskSize: number;
  spread: number;
  bookTimestampMs: number | null;
};

export type ConfidenceLabel = "low" | "medium" | "high";

export type Signal = {
  marketId: string;
  question: string;
  slug?: string;
  yes: TopOfBookQuote;
  no: TopOfBookQuote;
  isOpportunity: boolean;
  buyCompleteSetEdge: number;
  sellCompleteSetEdge: number;
  buyTopLiquidity: number;
  sellTopLiquidity: number;
  dominantAction: "buy" | "sell";
  dominantEdge: number;
  dominantTopLiquidity: number;
  combinedSpread: number;
  confidence: ConfidenceLabel;
  confidenceScore: number;
  stale: boolean;
  lastUpdated: string;
  reasoning: string[];
};

export type SignalsResponse = {
  generatedAt: string;
  scannedMarkets: number;
  evaluatedMarkets: number;
  opportunitiesFound: number;
  skippedIncomplete: number;
  bestBuyEdge: number | null;
  bestSellEdge: number | null;
  signals: Signal[];
  /** Present when the payload is a stale cache served due to a fetch failure. */
  servedFromCache?: boolean;
  cacheAgeMs?: number;
};
