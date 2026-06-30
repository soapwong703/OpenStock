"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Info } from "lucide-react";
import {
  getStockTechnicalData,
  getTechnicalSummary,
} from "@/lib/actions/ai.actions";
import type { TechnicalIndicators } from "@/lib/actions/ai.actions";

// ── Tooltip ─────────────────────────────────────────────────────────

const TA_HINTS: Record<string, string> = {
  RSI: "Relative Strength Index — measures speed/change of price movements on a scale of 0–100. Above 70 = overbought, below 30 = oversold.",
  SMA: "Simple Moving Average — average closing price over N periods. Price above SMA = uptrend, below = downtrend.",
  MACD: "Moving Average Convergence/Divergence — shows relationship between two EMAs. MACD line above signal = bullish, below = bearish.",
  KDJ: "Stochastic oscillator variant — K and D show price position within recent range. J amplifies the K/D crossover signal.",
  BB: "Bollinger Bands — SMA(20) ± 2 standard deviations. Price near upper band = overbought, near lower = oversold.",
  OBV: "On-Balance Volume — cumulative volume adjusted for price direction. Rising = buying pressure, falling = selling pressure.",
  Volume:
    "Number of shares traded in a period. High volume confirms price moves, low volume suggests weak conviction.",
};

function InfoTooltip({ hint }: { hint: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <Info className="ml-1 h-3 w-3 cursor-help text-gray-600 hover:text-gray-400" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs leading-relaxed text-gray-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {hint}
      </span>
    </span>
  );
}

interface Props {
  symbol: string;
}

function RSIWidget({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  if (value == null) return null;
  const color =
    value >= 70
      ? "text-rose-400"
      : value <= 30
        ? "text-emerald-400"
        : "text-gray-200";
  return (
    <span className="flex items-center gap-1">
      <span className="text-gray-500">{label}:</span>
      <span className={`font-semibold ${color}`}>{value.toFixed(1)}</span>
    </span>
  );
}

function RSIGroupWidget({
  rsi7,
  rsi14,
  rsi21,
}: {
  rsi7: number | null | undefined;
  rsi14: number | null | undefined;
  rsi21: number | null | undefined;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
      <span className="inline-flex items-center text-xs text-gray-500">
        RSI
        <InfoTooltip hint={TA_HINTS.RSI} />
      </span>
      <div className="mt-1 flex items-center gap-3 text-sm">
        <RSIWidget label="7" value={rsi7} />
        <RSIWidget label="14" value={rsi14} />
        <RSIWidget label="21" value={rsi21} />
      </div>
    </div>
  );
}

function SMAWidget({
  sma5,
  sma10,
  sma20,
  sma50,
  sma200,
  price,
}: {
  sma5: number | null | undefined;
  sma10: number | null | undefined;
  sma20: number | null | undefined;
  sma50: number | null | undefined;
  sma200: number | null | undefined;
  price: number | null | undefined;
}) {
  const items = [
    { label: "5", value: sma5 },
    { label: "10", value: sma10 },
    { label: "20", value: sma20 },
    { label: "50", value: sma50 },
    { label: "200", value: sma200 },
  ];

  return (
    <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
      <span className="inline-flex items-center text-xs text-gray-500">
        SMA
        <InfoTooltip hint={TA_HINTS.SMA} />
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {items.map(({ label, value }) => {
          if (value == null) return null;
          const above = price != null && price > value;
          return (
            <span key={label} className="flex items-center gap-1">
              <span className="text-gray-500">{label}:</span>
              <span
                className={`font-semibold ${above ? "text-emerald-400" : "text-rose-400"}`}
              >
                ${value.toFixed(2)}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function MACDWidget({ macd }: { macd: TechnicalIndicators["macd"] }) {
  if (!macd || macd.macd === null || macd.signal === null) return null;
  const bullish = macd.macd > macd.signal;
  return (
    <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
      <span className="inline-flex items-center text-xs text-gray-500">
        MACD (12, 26, 9)
        <InfoTooltip hint={TA_HINTS.MACD} />
      </span>
      <div className="mt-1 flex items-center gap-2 text-sm">
        <span className="font-semibold text-gray-200">
          {macd.macd.toFixed(2)}
        </span>
        <span className="text-gray-500">/</span>
        <span className="font-semibold text-gray-200">
          {macd.signal.toFixed(2)}
        </span>
        <span className={bullish ? "text-emerald-400" : "text-rose-400"}>
          {macd.histogram !== null
            ? ` (${macd.histogram >= 0 ? "+" : ""}${macd.histogram.toFixed(2)})`
            : ""}
        </span>
      </div>
    </div>
  );
}

function VolumeWidget({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const vol =
    value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}M`
      : value >= 1_000
        ? `${(value / 1_000).toFixed(0)}K`
        : String(value);
  return (
    <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
      <span className="inline-flex items-center text-xs text-gray-500">
        Volume
        <InfoTooltip hint={TA_HINTS.Volume} />
      </span>
      <p className="mt-0.5 text-sm font-semibold text-gray-200">{vol}</p>
    </div>
  );
}

function KDJWidget({
  k,
  d,
  j,
}: {
  k: number | null | undefined;
  d: number | null | undefined;
  j: number | null | undefined;
}) {
  if (k == null || d == null || j == null) return null;

  // Colour based on J line (most sensitive)
  const jColor =
    j > 100 ? "text-rose-400" : j < 0 ? "text-emerald-400" : "text-gray-200";

  // K/D crossover signal
  const bullCross = k > d;
  const crossColor = bullCross ? "text-emerald-400" : "text-rose-400";

  return (
    <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
      <span className="inline-flex items-center text-xs text-gray-500">
        KDJ (9, 3, 3)
        <InfoTooltip hint={TA_HINTS.KDJ} />
      </span>
      <div className="mt-1 flex items-center gap-3 text-sm">
        <span className="font-semibold text-gray-200">K: {k.toFixed(1)}</span>
        <span className="font-semibold text-gray-200">D: {d.toFixed(1)}</span>
        <span className={`font-semibold ${jColor}`}>J: {j.toFixed(1)}</span>
        <span className={`text-xs ${crossColor}`}>
          K {bullCross ? "↑" : "↓"} D
        </span>
      </div>
    </div>
  );
}

function BBWidget({
  upper,
  middle,
  lower,
  price,
}: {
  upper: number | null | undefined;
  middle: number | null | undefined;
  lower: number | null | undefined;
  price: number | null;
}) {
  if (upper == null || middle == null || lower == null) return null;

  // Where is price relative to the bands?
  const bandWidth = upper - lower;
  const relPos = bandWidth > 0 ? ((price ?? middle) - lower) / bandWidth : 0.5;

  // Colour based on proximity to upper (overbought) / lower (oversold)
  let bandColor = "text-gray-200";
  if (relPos > 0.9) bandColor = "text-rose-400";
  else if (relPos < 0.1) bandColor = "text-emerald-400";

  return (
    <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
      <span className="inline-flex items-center text-xs text-gray-500">
        Bollinger Bands (20, 2)
        <InfoTooltip hint={TA_HINTS.BB} />
      </span>
      <div className="mt-1 flex items-center gap-2 text-sm">
        <span className="font-semibold text-gray-200">${upper.toFixed(2)}</span>
        <span className="text-gray-500">/</span>
        <span className={`font-semibold ${bandColor}`}>
          ${middle.toFixed(2)}
        </span>
        <span className="text-gray-500">/</span>
        <span className="font-semibold text-gray-200">${lower.toFixed(2)}</span>
      </div>
    </div>
  );
}

function OBVWidget({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const absVal = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const obv =
    absVal >= 1_000_000
      ? `${sign}${(absVal / 1_000_000).toFixed(1)}M`
      : absVal >= 1_000
        ? `${sign}${(absVal / 1_000).toFixed(0)}K`
        : String(value);
  const color =
    value > 0
      ? "text-emerald-400"
      : value < 0
        ? "text-rose-400"
        : "text-gray-200";
  return (
    <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
      <span className="inline-flex items-center text-xs text-gray-500">
        OBV
        <InfoTooltip hint={TA_HINTS.OBV} />
      </span>
      <p className={`mt-0.5 text-sm font-semibold ${color}`}>{obv}</p>
    </div>
  );
}

export default function TechnicalIndicatorsCard({ symbol }: Props) {
  const [data, setData] = useState<TechnicalIndicators | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setSummary(null);
      try {
        const [result, aiSummary] = await Promise.all([
          getStockTechnicalData(symbol, forceRefresh),
          getTechnicalSummary(symbol, forceRefresh),
        ]);
        if (!result)
          console.warn(`⚠️ Technical indicators unavailable for ${symbol}`);
        setData(result);
        setSummary(aiSummary);
      } catch (e) {
        console.error(`❌ Technical indicators failed for ${symbol}:`, e);
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [symbol],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <section className="rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-950/60 to-gray-950/20 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
          Technical Indicators
        </h2>
        <button
          onClick={() => fetchData(true)}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-teal-800 hover:text-teal-400 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-9 w-full animate-pulse rounded-lg bg-gray-800"
            />
          ))}
        </div>
      )}

      {!loading && !data && (
        <p className="text-sm text-gray-500">
          Technical indicators currently unavailable.
        </p>
      )}

      {!loading && data && (
        <div className="space-y-3">
          {/* Moving averages — all in one compact row */}
          <SMAWidget
            sma5={data.sma5}
            sma10={data.sma10}
            sma20={data.sma20}
            sma50={data.sma50}
            sma200={data.sma200}
            price={data.currentPrice}
          />

          {/* RSI — three periods in one row */}
          <RSIGroupWidget
            rsi7={data.rsi7}
            rsi14={data.rsi14}
            rsi21={data.rsi21}
          />

          {/* MACD */}
          <MACDWidget macd={data.macd} />

          {/* KDJ */}
          <KDJWidget k={data.k} d={data.d} j={data.j} />

          {/* Bollinger Bands */}
          <BBWidget
            upper={data.bbUpper}
            middle={data.bbMiddle}
            lower={data.bbLower}
            price={data.currentPrice}
          />

          {/* OBV + Volume — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <OBVWidget value={data.obv} />
            <VolumeWidget value={data.volume} />
          </div>

          {/* AI summary */}
          {summary && (
            <div className="rounded-lg border border-teal-900/40 bg-teal-950/20 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-gray-300">{summary}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
