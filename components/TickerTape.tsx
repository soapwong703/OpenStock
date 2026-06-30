"use client";

import useTradingViewWidget from "@/hooks/useTradingViewWidget";
import { TICKER_TAPE_CONFIG } from "@/lib/constants";

interface TickerTapeProps {
  height?: number;
  className?: string;
}

export default function TickerTape({ className }: TickerTapeProps) {
  const scriptUrl =
    "https://widgets.tradingview-widget.com/w/en/tv-ticker-tape.js";

  const widgetConfig = {
    symbols: TICKER_TAPE_CONFIG.symbols.map((s) => s.symbol).join(","),
    theme: TICKER_TAPE_CONFIG.colorTheme,
    locale: TICKER_TAPE_CONFIG.locale,
  };

  const containerRef = useTradingViewWidget(
    scriptUrl,
    widgetConfig,
    TICKER_TAPE_CONFIG.height,
  );

  return (
    <div
      ref={containerRef}
      className={`w-full overflow-hidden rounded-xl border border-gray-800 bg-black/40 ${className ?? ""}`}
      style={{ height: TICKER_TAPE_CONFIG.height }}
    />
  );
}
