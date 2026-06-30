"use server";

import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
});

/** Shape returned by yahooFinance.quote() for the fields we need */
export interface YahooQuote {
  regularMarketPrice: number | null;
  regularMarketChange: number | null;
  regularMarketChangePercent: number | null;
  shortName?: string;
  longName?: string;
}

/** Shape returned by yahooFinance.chart() for each bar */
export interface YahooBar {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjclose?: number | null;
}

/** Shape returned by yahooFinance.quoteSummary() for the profile fields we need */
export interface YahooCompanyProfile {
  name: string | null;
  marketCap: number | null;
  exchange: string | null;
  currency: string | null;
}

// ── Quote ───────────────────────────────────────────────────────────

/**
 * Fetch a real-time stock quote using Yahoo Finance.
 * Returns null on failure (no API key needed).
 */
export async function getYahooQuote(
  symbol: string,
): Promise<YahooQuote | null> {
  try {
    const result = await yf.quote(symbol.toUpperCase());
    return {
      regularMarketPrice: result.regularMarketPrice ?? null,
      regularMarketChange: result.regularMarketChange ?? null,
      regularMarketChangePercent: result.regularMarketChangePercent ?? null,
      shortName: result.shortName,
      longName: result.longName,
    };
  } catch (e) {
    console.error(`❌ Yahoo quote failed for ${symbol}:`, e);
    return null;
  }
}

// ── Company Profile ──────────────────────────────────────────────────

/**
 * Fetch company profile (name, market cap, etc.) using Yahoo Finance.
 * Returns null on failure.
 */
export async function getYahooCompanyProfile(
  symbol: string,
): Promise<YahooCompanyProfile | null> {
  try {
    const sym = symbol.toUpperCase();
    const summary = await yf.quoteSummary(sym, {
      modules: ["assetProfile", "price"],
    });

    return {
      name: summary.price?.longName ?? summary.price?.shortName ?? null,
      marketCap: summary.price?.marketCap ?? null,
      exchange: summary.price?.exchangeName ?? null,
      currency: summary.price?.currency ?? null,
    };
  } catch (e) {
    console.error(`❌ Yahoo profile failed for ${symbol}:`, e);
    return null;
  }
}

// ── Historical Daily Bars ────────────────────────────────────────────

/**
 * Fetch daily OHLCV bars for a symbol using Yahoo Finance.
 * Returns at least 250 bars for computing indicators, or null on failure.
 */
export async function getYahooHistoricalBars(
  symbol: string,
): Promise<YahooBar[] | null> {
  try {
    const sym = symbol.toUpperCase();
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 2); // 2 years back

    console.log(
      `📡 Yahoo bars ${sym}: fetching from ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
    );

    const result = await yf.chart(sym, {
      period1: start.toISOString().slice(0, 10),
      period2: end.toISOString().slice(0, 10),
      interval: "1d",
    });

    const bars = result.quotes as YahooBar[];
    if (!bars || bars.length === 0) {
      console.log(`📡 Yahoo bars ${sym}: empty response`);
      return null;
    }

    console.log(`✅ Yahoo bars ${sym}: ${bars.length} days`);
    return bars;
  } catch (e) {
    console.error(`❌ Yahoo bars failed for ${symbol}:`, e);
    if (e instanceof Error) {
      console.error(`   Message: ${e.message}`);
      console.error(`   Stack: ${e.stack?.split("\n").slice(0, 3).join("\n")}`);
    }
    return null;
  }
}
