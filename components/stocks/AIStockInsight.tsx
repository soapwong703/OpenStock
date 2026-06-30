"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, RefreshCw, AlertCircle } from "lucide-react";
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
    <section className="relative overflow-hidden rounded-2xl border border-teal-900/40 bg-gradient-to-br from-gray-900 via-gray-950 to-black p-6 md:p-8 shadow-lg shadow-teal-900/5">
      {/* Background decorative gradient */}
      <div className="pointer-events-none absolute -inset-px opacity-40">
        <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-teal-500/5 blur-3xl" />
      </div>

      <div className="relative">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500/20 to-teal-500/5 ring-1 ring-teal-500/20">
              <Sparkles className="h-5 w-5 text-teal-400" />
            </div>
            <div>
              <h2 className="text-base font-bold uppercase tracking-[0.18em] text-gray-300">
                AI Stock Analysis
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">{symbol}</p>
            </div>
          </div>
          <button
            onClick={() => fetchAnalysis(true)}
            disabled={loading}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-700/60 bg-gray-800/50 px-3 py-2 text-xs font-medium text-gray-400 transition-all hover:border-teal-700 hover:bg-teal-500/10 hover:text-teal-300 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        {/* Content area */}
        <div className="min-h-[72px]">
          {loading && (
            <div className="space-y-3">
              <div className="h-5 w-full animate-pulse rounded-md bg-gradient-to-r from-gray-800 via-gray-700/60 to-gray-800" />
              <div className="h-5 w-5/6 animate-pulse rounded-md bg-gradient-to-r from-gray-800 via-gray-700/60 to-gray-800" />
              <div className="h-5 w-4/6 animate-pulse rounded-md bg-gradient-to-r from-gray-800 via-gray-700/60 to-gray-800" />
              <div className="h-5 w-3/4 animate-pulse rounded-md bg-gradient-to-r from-gray-800 via-gray-700/60 to-gray-800" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-900/30 bg-rose-950/10 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
              <div>
                <p className="font-medium text-rose-300">
                  Unable to generate analysis
                </p>
                <p className="mt-1 text-sm text-rose-400/80">
                  The AI service is temporarily unavailable.{" "}
                  <button
                    onClick={() => fetchAnalysis(true)}
                    className="font-medium underline underline-offset-2 hover:text-rose-200"
                  >
                    Try again
                  </button>
                </p>
              </div>
            </div>
          )}

          {!loading && !error && analysis && (
            <div className="rounded-xl border border-teal-900/20 bg-gradient-to-r from-teal-500/5 to-transparent p-5">
              <p className="text-base leading-relaxed text-gray-200 md:text-lg">
                {analysis}
              </p>
              <div className="mt-4 flex items-center gap-2 border-t border-gray-800/60 pt-3">
                <span className="flex h-1.5 w-1.5 rounded-full bg-teal-500" />
                <p className="text-xs text-gray-600">
                  AI-generated — not financial advice
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
