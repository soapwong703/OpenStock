"use client";

import { useEffect, useState } from "react";
import { getChartBars } from "@/lib/actions/ai.actions";
import LightweightChart from "@/components/LightweightChart";
import type { YahooBar } from "@/lib/actions/yahoo-finance.actions";

export default function ChartContainer({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<YahooBar[] | null>(null);

  useEffect(() => {
    getChartBars(symbol)
      .then(setBars)
      .catch(() => setBars(null));
  }, [symbol]);

  if (!bars || bars.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-950 p-8 text-center text-sm text-gray-500">
        Chart data is currently unavailable for {symbol}.
      </div>
    );
  }

  return <LightweightChart bars={bars} symbol={symbol.toUpperCase()} />;
}
