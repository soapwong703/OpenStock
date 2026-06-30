"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getStockTechnicalData } from "@/lib/actions/ai.actions";
import type { TechnicalIndicators } from "@/lib/actions/ai.actions";

interface Props {
  symbol: string;
}

function RSIWidget({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-600">—</span>;
  const color =
    value >= 70
      ? "text-rose-400"
      : value <= 30
        ? "text-emerald-400"
        : "text-gray-200";
  return <span className={`font-semibold ${color}`}>{value.toFixed(1)}</span>;
}

function MVWidget({
  label,
  value,
  price,
}: {
  label: string;
  value: number | null;
  price: number | null;
}) {
  if (value === null) return null;
  const above = price !== null && price > value;
  const color = above ? "text-emerald-400" : "text-rose-400";
  const Icon = above ? TrendingUp : TrendingDown;
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-gray-200">
          ${value.toFixed(2)}
        </span>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
    </div>
  );
}

function MACDWidget({ macd }: { macd: TechnicalIndicators["macd"] }) {
  if (!macd || macd.macd === null || macd.signal === null) return null;
  const bullish = macd.macd > macd.signal;
  return (
    <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
      <span className="text-xs text-gray-500">MACD</span>
      <div className="mt-1 flex items-center gap-2 text-sm">
        <span className="font-semibold text-gray-200">
          MACD: {macd.macd.toFixed(2)}
        </span>
        <span className="text-gray-500">/</span>
        <span className="font-semibold text-gray-200">
          Sig: {macd.signal.toFixed(2)}
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

function VolumeWidget({ value }: { value: number | null }) {
  if (value === null) return null;
  const vol =
    value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}M`
      : value >= 1_000
        ? `${(value / 1_000).toFixed(0)}K`
        : String(value);
  return (
    <div className="rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
      <span className="text-xs text-gray-500">Volume</span>
      <p className="mt-0.5 text-sm font-semibold text-gray-200">{vol}</p>
    </div>
  );
}

export default function TechnicalIndicatorsCard({ symbol }: Props) {
  const [data, setData] = useState<TechnicalIndicators | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getStockTechnicalData(symbol);
      if (!result)
        console.warn(`⚠️ Technical indicators unavailable for ${symbol}`);
      setData(result);
    } catch (e) {
      console.error(`❌ Technical indicators failed for ${symbol}:`, e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

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
          onClick={fetchData}
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
          {/* RSI */}
          <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-black/20 px-3 py-2">
            <span className="text-xs text-gray-500">RSI (14)</span>
            <RSIWidget value={data.rsi} />
          </div>

          {/* Moving averages */}
          <MVWidget label="SMA (20)" value={data.sma20} price={data.sma20} />
          <MVWidget label="SMA (50)" value={data.sma50} price={data.sma50} />
          <MVWidget label="SMA (200)" value={data.sma200} price={data.sma200} />

          {/* MACD */}
          <MACDWidget macd={data.macd} />

          {/* VWAP */}
          <MVWidget label="VWAP" value={data.vwap} price={data.vwap} />

          {/* Volume */}
          <VolumeWidget value={data.volume} />
        </div>
      )}
    </section>
  );
}
