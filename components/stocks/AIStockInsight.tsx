"use client";

import { useCallback } from "react";
import AIChatCard from "@/components/AIChatCard";
import { getAIStockAnalysis } from "@/lib/actions/ai.actions";

interface AIStockInsightProps {
  symbol: string;
}

export default function AIStockInsight({ symbol }: AIStockInsightProps) {
  const fetchAnalysis = useCallback(
    (forceRefresh?: boolean) => getAIStockAnalysis(symbol, forceRefresh),
    [symbol],
  );

  return (
    <AIChatCard
      title="AI Stock Analysis"
      subtitle={symbol}
      fetchData={fetchAnalysis}
    />
  );
}
