"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Signal, SignalsResponse } from "@/lib/types";

const POLL_INTERVAL_MS = 25_000;
const THEME_STORAGE_KEY = "polymarket-scanner-theme";
const POSITIVE_ONLY_STORAGE_KEY = "polymarket-scanner-positive-only-v2";
const INCLUDE_LONG_SHOTS_STORAGE_KEY =
  "polymarket-scanner-include-long-shots-v1";
const EXTREME_LONG_SHOT_FLOOR = 0.02;
const EXTREME_LONG_SHOT_CEILING = 0.98;

type ThemeMode = "light" | "dark";

function ThemeIcon({ theme }: { theme: ThemeMode }) {
  if (theme === "light") {
    return (
      <svg
        aria-hidden="true"
        className="theme-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="theme-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.25M12 19.25v2.25M21.5 12h-2.25M4.75 12H2.5M18.72 5.28l-1.59 1.59M6.87 17.13l-1.59 1.59M18.72 18.72l-1.59-1.59M6.87 6.87 5.28 5.28" />
    </svg>
  );
}

function formatCents(price: number) {
  return `${(price * 100).toFixed(1)}c`;
}

function formatEdge(edge: number | null) {
  if (edge === null) return "—";
  const percent = edge * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

function formatSets(size: number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(size)}`;
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

function formatRelative(iso: string, nowMs: number) {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return formatTime(iso);
}

function edgeClassName(edge: number) {
  if (edge > 0) return "edge positive";
  if (edge < 0) return "edge negative";
  return "edge";
}

function isExtremeLongShot(signal: Signal) {
  const prices = [
    signal.yes.bestBid,
    signal.yes.bestAsk,
    signal.no.bestBid,
    signal.no.bestAsk,
  ];

  return prices.some(
    (price) =>
      price <= EXTREME_LONG_SHOT_FLOOR || price >= EXTREME_LONG_SHOT_CEILING,
  );
}

function getBestPositiveEdge(
  signals: Signal[],
  accessor: (signal: Signal) => number,
) {
  const positiveEdges = signals.map(accessor).filter((edge) => edge > 0);
  return positiveEdges.length > 0 ? Math.max(...positiveEdges) : null;
}

async function fetchSignals(): Promise<SignalsResponse> {
  const response = await fetch("/api/signals", { cache: "no-store" });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? `Upstream returned ${response.status}.`);
  }

  return (await response.json()) as SignalsResponse;
}

function SignalDetails({ signal, nowMs }: { signal: Signal; nowMs: number }) {
  return (
    <div className="details-panel">
      <div className="details-grid">
        <div>
          <h3>Reasoning</h3>
          <ul>
            {signal.reasoning.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>

        <div className="formula-block">
          <div className="details-metrics-grid">
            <div className="details-metric">
              <span className="details-metric-label">Best edge</span>
              <span className={edgeClassName(signal.dominantEdge)}>
                {formatEdge(signal.dominantEdge)}
              </span>
            </div>
            <div className="details-metric">
              <span className="details-metric-label">Confidence</span>
              <span>{signal.confidence} · {signal.confidenceScore.toFixed(0)}/100</span>
            </div>
            <div className="details-metric">
              <span className="details-metric-label">Combined spread</span>
              <span>{formatCents(signal.combinedSpread)}</span>
            </div>
            <div className="details-metric">
              <span className="details-metric-label">Book freshness</span>
              <span>
                {formatRelative(signal.lastUpdated, nowMs)} ·{" "}
                {signal.stale ? "stale" : "fresh"}
              </span>
            </div>
          </div>
          <div className="formula-line">
            <strong>Buy complete set</strong>
            <br />
            1 − ({signal.yes.bestAsk.toFixed(3)} + {signal.no.bestAsk.toFixed(3)}) ={" "}
            {signal.buyCompleteSetEdge.toFixed(4)}
          </div>
          <div className="formula-line">
            <strong>Sell complete set</strong>
            <br />
            ({signal.yes.bestBid.toFixed(3)} + {signal.no.bestBid.toFixed(3)}) − 1 ={" "}
            {signal.sellCompleteSetEdge.toFixed(4)}
          </div>
          <div className="formula-line">
            <strong>Top-of-book size</strong>
            <br />
            Buy min({signal.yes.bestAskSize.toFixed(0)},{" "}
            {signal.no.bestAskSize.toFixed(0)}) ={" "}
            {signal.buyTopLiquidity.toFixed(0)} sets
            <br />
            Sell min({signal.yes.bestBidSize.toFixed(0)},{" "}
            {signal.no.bestBidSize.toFixed(0)}) ={" "}
            {signal.sellTopLiquidity.toFixed(0)} sets
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, index) => (
        <tr className="skeleton-row" key={index}>
          <td colSpan={7}>
            <span className="skeleton-bar" />
          </td>
        </tr>
      ))}
    </>
  );
}

export function SignalsDashboard() {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedSignalId, setExpandedSignalId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [positiveOnly, setPositiveOnly] = useState(true);
  const [includeExtremeLongShots, setIncludeExtremeLongShots] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    } else {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
      setTheme(systemTheme);
    }

    const savedPositiveOnly = window.localStorage.getItem(POSITIVE_ONLY_STORAGE_KEY);
    if (savedPositiveOnly === "true" || savedPositiveOnly === "false") {
      setPositiveOnly(savedPositiveOnly === "true");
    }

    const savedIncludeLongShots = window.localStorage.getItem(
      INCLUDE_LONG_SHOTS_STORAGE_KEY,
    );
    if (savedIncludeLongShots === "true" || savedIncludeLongShots === "false") {
      setIncludeExtremeLongShots(savedIncludeLongShots === "true");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(
      POSITIVE_ONLY_STORAGE_KEY,
      positiveOnly ? "true" : "false",
    );
  }, [positiveOnly]);

  useEffect(() => {
    window.localStorage.setItem(
      INCLUDE_LONG_SHOTS_STORAGE_KEY,
      includeExtremeLongShots ? "true" : "false",
    );
  }, [includeExtremeLongShots]);

  const loadSignals = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const payload = await fetchSignals();
      setData(payload);
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load signals.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSignals();

    const intervalId = window.setInterval(() => {
      void loadSignals({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [loadSignals]);

  // Tick-based "x seconds ago" without re-fetching.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const allSignals = data?.signals ?? [];
  const candidateSignals = useMemo(
    () =>
      allSignals.filter(
        (signal) => includeExtremeLongShots || !isExtremeLongShot(signal),
      ),
    [allSignals, includeExtremeLongShots],
  );
  const opportunitySignals = useMemo(
    () => candidateSignals.filter((signal) => signal.isOpportunity),
    [candidateSignals],
  );
  const nearMissSignals = useMemo(
    () => candidateSignals.filter((signal) => !signal.isOpportunity),
    [candidateSignals],
  );
  const visibleSignals = useMemo(
    () => (positiveOnly ? opportunitySignals : candidateSignals),
    [candidateSignals, opportunitySignals, positiveOnly],
  );
  const hiddenNearMissCount = positiveOnly ? nearMissSignals.length : 0;
  const hiddenLongShotCount = allSignals.length - candidateSignals.length;
  const bestVisibleBuyEdge = useMemo(
    () => getBestPositiveEdge(candidateSignals, (signal) => signal.buyCompleteSetEdge),
    [candidateSignals],
  );
  const bestVisibleSellEdge = useMemo(
    () => getBestPositiveEdge(candidateSignals, (signal) => signal.sellCompleteSetEdge),
    [candidateSignals],
  );
  const nextTheme = theme === "light" ? "dark" : "light";
  const servedFromCache = data?.servedFromCache === true;

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Signal-only scanner</span>
          <h1>Polymarket Opportunity Scanner</h1>
          <p>
            A read-only dashboard that scans active Polymarket binary markets for
            complete-set pricing edges. No wallets, no trading, no execution.
          </p>
        </div>

        <div className="hero-actions">
          <button
            aria-label={`Switch to ${nextTheme} mode`}
            className="theme-toggle"
            onClick={() => setTheme(nextTheme)}
            title={`Switch to ${nextTheme} mode`}
            type="button"
          >
            <ThemeIcon theme={theme} />
          </button>
          <button
            className="refresh-button"
            onClick={() => void loadSignals({ silent: true })}
            disabled={loading || refreshing}
            type="button"
          >
            {loading ? "Loading…" : refreshing ? "Refreshing…" : "Refresh now"}
          </button>
          <span className="chip">Auto-refresh {POLL_INTERVAL_MS / 1000}s</span>
        </div>
      </section>

      <section className="summary-grid">
        <div className="summary-card">
          <div className="summary-label">Markets scanned</div>
          <div className="summary-value">{data?.scannedMarkets ?? "—"}</div>
          <div className="summary-note">Active order-book markets per refresh.</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Opportunities</div>
          <div className="summary-value">
            {data ? opportunitySignals.length : "—"}
          </div>
          <div className="summary-note">Positive dominant edges after filters.</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Best buy edge</div>
          <div className="summary-value">{formatEdge(bestVisibleBuyEdge)}</div>
          <div className="summary-note">
            Best positive buy edge after filters.
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Best sell edge</div>
          <div className="summary-value">{formatEdge(bestVisibleSellEdge)}</div>
          <div className="summary-note">
            Best positive sell edge after filters.
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <h2>Ranked signals</h2>
            <p>
              Positive-edge opportunities are shown by default. Near-misses and
              extreme long-shots are available only when you explicitly opt in.
            </p>
          </div>
          <div className="panel-controls">
            <label className="toggle">
              <input
                type="checkbox"
                checked={positiveOnly}
                onChange={(event) => setPositiveOnly(event.target.checked)}
              />
              <span className="toggle-track" aria-hidden="true">
                <span className="toggle-thumb" />
              </span>
              <span className="toggle-label">Positive edge only</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={includeExtremeLongShots}
                onChange={(event) =>
                  setIncludeExtremeLongShots(event.target.checked)
                }
              />
              <span className="toggle-track" aria-hidden="true">
                <span className="toggle-thumb" />
              </span>
              <span className="toggle-label">Include long-shots</span>
            </label>
            <p className="panel-meta">
              {data
                ? `Refreshed ${formatRelative(data.generatedAt, nowMs)}`
                : "Waiting for first snapshot"}
            </p>
          </div>
        </div>

        {servedFromCache ? (
          <div className="banner warning">
            Upstream Polymarket fetch failed — showing the last good snapshot (
            {Math.round((data?.cacheAgeMs ?? 0) / 1000)}s old).
          </div>
        ) : null}

        {error ? (
          <div className="banner error">
            <span>{error}</span>
            <button
              className="banner-action"
              onClick={() => void loadSignals({ silent: true })}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : null}

        {!error && !loading && visibleSignals.length === 0 ? (
          <div className="empty-state">
            {positiveOnly ? (
              <>
                <h3>No positive-edge opportunities right now</h3>
                <p>
                  {nearMissSignals.length} near-miss
                  {nearMissSignals.length === 1 ? "" : "es"} available if you want
                  to inspect market structure.
                  {hiddenLongShotCount > 0
                    ? ` ${hiddenLongShotCount} extreme long-shot market${
                        hiddenLongShotCount === 1 ? " is" : "s are"
                      } hidden by default.`
                    : ""}
                </p>
                <div className="empty-state-actions">
                  {nearMissSignals.length > 0 ? (
                    <button
                      className="secondary-button"
                      onClick={() => setPositiveOnly(false)}
                      type="button"
                    >
                      View near-misses
                    </button>
                  ) : null}
                  {hiddenLongShotCount > 0 && !includeExtremeLongShots ? (
                    <button
                      className="link-button"
                      onClick={() => setIncludeExtremeLongShots(true)}
                      type="button"
                    >
                      Include extreme long-shots
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <h3>No candidates passed the current filters</h3>
                <p>
                  Try including extreme long-shots or wait for the next refresh.
                </p>
                {hiddenLongShotCount > 0 && !includeExtremeLongShots ? (
                  <button
                    className="link-button"
                    onClick={() => setIncludeExtremeLongShots(true)}
                    type="button"
                  >
                    Include extreme long-shots
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {visibleSignals.length > 0 || (loading && !data) ? (
          <div className="table-wrap">
            <table className="signals-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>YES bid / ask</th>
                  <th>NO bid / ask</th>
                  <th>Best edge</th>
                  <th>Liquidity</th>
                  <th>Freshness</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  <SkeletonRows rows={6} />
                ) : (
                  visibleSignals.map((signal, index) => {
                    const expanded = expandedSignalId === signal.marketId;
                    const marketUrl = signal.slug
                      ? `https://polymarket.com/event/${signal.slug}`
                      : null;

                    return (
                      <Fragment key={signal.marketId}>
                        <tr className={signal.isOpportunity ? "row-opportunity" : ""}>
                          <td className="market-cell">
                            <div className="market-topline">
                              <span className="rank-pill">{index + 1}</span>
                              <span className={`signal-badge ${signal.dominantAction}`}>
                                {signal.isOpportunity
                                  ? `${signal.dominantAction.toUpperCase()} opportunity`
                                  : `${signal.dominantAction.toUpperCase()} near-miss`}
                              </span>
                            </div>
                            {marketUrl ? (
                              <a
                                className="market-question market-link"
                                href={marketUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                title="Open on Polymarket"
                              >
                                {signal.question}
                              </a>
                            ) : (
                              <p className="market-question">{signal.question}</p>
                            )}
                          </td>
                          <td>
                            <div className="quote-pair">
                              <div className="quote-main">
                                {formatCents(signal.yes.bestBid)} /{" "}
                                {formatCents(signal.yes.bestAsk)}
                              </div>
                              <div className="quote-subline">
                                sizes {signal.yes.bestBidSize.toFixed(0)} /{" "}
                                {signal.yes.bestAskSize.toFixed(0)}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="quote-pair">
                              <div className="quote-main">
                                {formatCents(signal.no.bestBid)} /{" "}
                                {formatCents(signal.no.bestAsk)}
                              </div>
                              <div className="quote-subline">
                                sizes {signal.no.bestBidSize.toFixed(0)} /{" "}
                                {signal.no.bestAskSize.toFixed(0)}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="quote-pair">
                              <div className={edgeClassName(signal.dominantEdge)}>
                                {formatEdge(signal.dominantEdge)}
                              </div>
                              <div className="quote-subline">
                                {signal.dominantAction.toUpperCase()} complete set
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="quote-pair">
                              <div className="metric-strong">
                                {formatSets(signal.dominantTopLiquidity)} sets
                              </div>
                              <div className="quote-subline">top of book</div>
                            </div>
                          </td>
                          <td>
                            <div className="quote-pair">
                              <div className="metric-strong">
                                {formatRelative(signal.lastUpdated, nowMs)}
                              </div>
                              <div className="quote-subline">
                                {signal.stale ? "stale" : "fresh"}
                              </div>
                            </div>
                          </td>
                          <td>
                            <button
                              aria-expanded={expanded}
                              className="details-button"
                              onClick={() =>
                                setExpandedSignalId(expanded ? null : signal.marketId)
                              }
                              type="button"
                            >
                              {expanded ? "Hide" : "Show"}
                            </button>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="details-row">
                            <td colSpan={7}>
                              <SignalDetails signal={signal} nowMs={nowMs} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {!loading && (hiddenNearMissCount > 0 || hiddenLongShotCount > 0) ? (
          <div className="panel-footer">
            {hiddenNearMissCount > 0 ? (
              <>
                {hiddenNearMissCount} near-miss
                {hiddenNearMissCount === 1 ? "" : "es"} hidden by the
                positive-edge filter.
              </>
            ) : (
              <>Positive-edge filter is off.</>
            )}
            {hiddenLongShotCount > 0 ? (
              <>
                {" "}
                {hiddenLongShotCount} extreme long-shot market
                {hiddenLongShotCount === 1 ? "" : "s"} hidden by default.
              </>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
