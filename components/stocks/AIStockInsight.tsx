"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { getAIStockAnalysis } from "@/lib/actions/ai.actions";

interface AIStockInsightProps {
  symbol: string;
}

export default function AIStockInsight({ symbol }: AIStockInsightProps) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchAnalysis = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(false);
      try {
        const text = await getAIStockAnalysis(symbol, forceRefresh);
        setAnalysis(text);
      } catch {
        setError(true);
        setAnalysis(null);
      } finally {
        setLoading(false);
      }
    },
    [symbol],
  );

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  return (
    <section className="rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-950/60 to-gray-950/20 p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/10">
            <Sparkles className="h-4 w-4 text-teal-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
              AI Stock Analysis
            </h2>
            <p className="text-[11px] text-gray-500">{symbol}</p>
          </div>
        </div>
        <button
          onClick={() => fetchAnalysis(true)}
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
          <div className="h-4 w-full animate-pulse rounded bg-gray-800" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-gray-800" />
          <div className="h-4 w-4/6 animate-pulse rounded bg-gray-800" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-gray-800" />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-900/30 bg-rose-950/10 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <p className="text-sm text-rose-300">
            Unable to generate analysis for {symbol}.{" "}
            <button
              onClick={() => fetchAnalysis(true)}
              className="underline underline-offset-2 hover:text-rose-200"
            >
              Try again
            </button>
          </p>
        </div>
      )}

      {!loading && !error && analysis && (
        <div className="rounded-xl border border-gray-800 bg-black/20 p-4">
          <p className="text-sm leading-relaxed text-gray-300">{analysis}</p>
          <p className="mt-3 text-[11px] text-gray-600">
            AI-generated analysis — not financial advice. Verify before acting.
          </p>
        </div>
      )}
    </section>
  );
}
