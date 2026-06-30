"use client";
import { useEffect, useRef } from "react";

/**
 * Detects whether a script URL is a Web Component widget (Ticker Tape, Tickers, etc.)
 * Web Components use the `widgets.tradingview-widget.com/w/en/` CDN path.
 */
function isWebComponentWidget(scriptUrl: string): boolean {
  return scriptUrl.includes("widgets.tradingview-widget.com/w/en/");
}

const useTradingViewWidget = (
  scriptUrl: string,
  config: Record<string, unknown>,
  height: number | string = 600,
) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous instance
    containerRef.current.innerHTML = "";

    if (isWebComponentWidget(scriptUrl)) {
      // ── Web Component widgets (Ticker Tape, Tickers, etc.) ──
      // Config is passed as HTML attributes on the custom element.
      // Build the element from config keys.
      const tagName = scriptUrl.split("/").pop()?.replace(".js", "") ?? "";
      const attrs = Object.entries(config)
        .map(([key, value]) => {
          if (typeof value === "string")
            return `${key}="${value.replace(/"/g, "&quot;")}"`;
          if (Array.isArray(value)) return `${key}="${value.join(",")}"`;
          return `${key}="${String(value)}"`;
        })
        .join(" ");

      containerRef.current.innerHTML = `<div class="tradingview-widget-container" style="height: ${height}px;"><${tagName} ${attrs}></${tagName}></div>`;

      const script = document.createElement("script");
      script.src = scriptUrl;
      script.type = "module";
      script.async = true;
      containerRef.current.appendChild(script);
    } else {
      // ── Iframe widgets (all standard TradingView widgets) ──
      const isAutosize = config.autosize === true;
      const styleHeight = isAutosize ? "100%" : `${height}px`;

      containerRef.current.innerHTML = `<div class="tradingview-widget-container__widget" style="width: 100%; height: ${styleHeight};"></div>`;

      const script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      script.innerHTML = JSON.stringify(config);

      containerRef.current.appendChild(script);
    }

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [scriptUrl, JSON.stringify(config), height]); // Use stringified config to avoid ref issues

  return containerRef;
};
export default useTradingViewWidget;
