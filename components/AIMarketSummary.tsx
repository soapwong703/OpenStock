"use client";

import AIChatCard from "@/components/AIChatCard";
import { getAIMarketSummary } from "@/lib/actions/ai.actions";

export default function AIMarketSummary() {
  return (
    <AIChatCard
      title="AI Market Brief"
      subtitle="Real-time analysis powered by AI"
      fetchData={getAIMarketSummary}
    />
  );
}
