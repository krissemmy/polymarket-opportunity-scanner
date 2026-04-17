"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Signal, SignalsResponse } from "@/lib/types";

const POLL_INTERVAL_MS = 25_000;
const THEME_STORAGE_KEY = "polymarket-scanner-theme";
const POSITIVE_ONLY_STORAGE_KEY = "polymarket-scanner-positive-only";

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

function SignalDetails({ signal }: { signal: Signal }) {
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
          <td colSpan={11}>
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
  const [positiveOnly, setPositiveOnly] = useState(false);
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
    if (savedPositiveOnly === "true") setPositiveOnly(true);
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
  const visibleSignals = useMemo(
    () => (positiveOnly ? allSignals.filter((s) => s.isOpportunity) : allSignals),
    [allSignals, positiveOnly],
  );
  const hiddenByFilter = allSignals.length - visibleSignals.length;
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
          <div className="summary-value">{data?.opportunitiesFound ?? "—"}</div>
          <div className="summary-note">Markets with a positive dominant edge.</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Best buy edge</div>
          <div className="summary-value">
            {formatEdge(data?.bestBuyEdge ?? null)}
          </div>
          <div className="summary-note">
            Largest 1 − (YES ask + NO ask) across the scan.
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Best sell edge</div>
          <div className="summary-value">
            {formatEdge(data?.bestSellEdge ?? null)}
          </div>
          <div className="summary-note">
            Largest (YES bid + NO bid) − 1 across the scan.
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <h2>Ranked signals</h2>
            <p>
              Opportunities first, then near-misses. Ranked by dominant edge,
              then top-of-book depth, then spread tightness.
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
            {positiveOnly
              ? "No positive-edge opportunities right now. Book-tightness alone isn’t an opportunity."
              : "No candidates passed the current spread and liquidity filters."}
            {hiddenByFilter > 0 && positiveOnly ? (
              <>
                {" "}
                <button
                  className="link-button"
                  onClick={() => setPositiveOnly(false)}
                  type="button"
                >
                  Show {hiddenByFilter} near-miss
                  {hiddenByFilter === 1 ? "" : "es"}
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="table-wrap">
          <table className="signals-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Market</th>
                <th>YES bid / ask</th>
                <th>NO bid / ask</th>
                <th>Buy edge</th>
                <th>Sell edge</th>
                <th>Spread</th>
                <th>Top size</th>
                <th>Confidence</th>
                <th>Book</th>
                <th>Reasoning</th>
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
                        <td className="rank-cell">
                          <span className="rank-pill">{index + 1}</span>
                        </td>
                        <td className="market-cell">
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
                          <div className="badge-row">
                            <span className={`signal-badge ${signal.dominantAction}`}>
                              {signal.isOpportunity
                                ? `${signal.dominantAction.toUpperCase()} opportunity`
                                : `${signal.dominantAction.toUpperCase()} near-miss`}
                            </span>
                            <span className="tiny-note">
                              Dominant {formatEdge(signal.dominantEdge)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="quote-pair">
                            <div className="quote-main">
                              {formatCents(signal.yes.bestBid)} /{" "}
                              {formatCents(signal.yes.bestAsk)}
                            </div>
                            <div className="quote-subline">
                              {signal.yes.bestBidSize.toFixed(0)} /{" "}
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
                              {signal.no.bestBidSize.toFixed(0)} /{" "}
                              {signal.no.bestAskSize.toFixed(0)}
                            </div>
                          </div>
                        </td>
                        <td className={edgeClassName(signal.buyCompleteSetEdge)}>
                          {formatEdge(signal.buyCompleteSetEdge)}
                        </td>
                        <td className={edgeClassName(signal.sellCompleteSetEdge)}>
                          {formatEdge(signal.sellCompleteSetEdge)}
                        </td>
                        <td>
                          <div className="quote-pair">
                            <div className="metric-strong">
                              {formatCents(signal.combinedSpread)}
                            </div>
                            <div className="quote-subline">
                              Y {formatCents(signal.yes.spread)} / N{" "}
                              {formatCents(signal.no.spread)}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="quote-pair">
                            <div className="metric-strong">
                              {formatSets(signal.dominantTopLiquidity)} sets
                            </div>
                            <div className="quote-subline">
                              B {formatSets(signal.buyTopLiquidity)} / S{" "}
                              {formatSets(signal.sellTopLiquidity)}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="quote-pair">
                            <span className={`confidence-badge ${signal.confidence}`}>
                              {signal.confidence}
                            </span>
                            <div className="quote-subline">
                              {signal.confidenceScore.toFixed(0)}/100
                            </div>
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
                          <td colSpan={11}>
                            <SignalDetails signal={signal} />
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

        {!loading && positiveOnly && hiddenByFilter > 0 ? (
          <div className="panel-footer">
            {hiddenByFilter} near-miss{hiddenByFilter === 1 ? "" : "es"} hidden by
            the positive-edge filter.
          </div>
        ) : null}
      </section>
    </div>
  );
}
