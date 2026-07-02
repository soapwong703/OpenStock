"use server";

import { callAIProvider, getProviderConfig } from "@/lib/ai-provider";
import { getNews } from "@/lib/actions/finnhub.actions";
import {
  getYahooQuote,
  getYahooCompanyProfile,
  getYahooHistoricalBars,
} from "@/lib/actions/yahoo-finance.actions";
import type { YahooBar } from "@/lib/actions/yahoo-finance.actions";
import { connectToDatabase } from "@/database/mongoose";
import { Cache } from "@/database/models/ai-cache.model";
import talib from "talib";

// ── Types ────────────────────────────────────────────────────────────

export interface TechnicalIndicators {
  currentPrice: number | null;
  rsi7: number | null;
  rsi14: number | null;
  rsi21: number | null;
  sma5: number | null;
  sma10: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  macd: {
    macd: number | null;
    signal: number | null;
    histogram: number | null;
  } | null;
  /** KDJ (Stochastic) — K line, D line, J line */
  k: number | null;
  d: number | null;
  j: number | null;
  /** Bollinger Bands (20, 2) — upper, middle (= SMA20), lower */
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  /** On-Balance Volume */
  obv: number | null;
  volume: number | null;
}

// ── Yahoo Finance Market Data (cached, 1-day TTL) ────────────────────

/** Public wrapper to get cached bars for chart display. */
export async function getChartBars(symbol: string): Promise<YahooBar[] | null> {
  return getCachedYahooBars(symbol);
}

/**
 * Fetch daily bars for a symbol using Yahoo Finance, with DB caching.
 * Returns at least 250 bars for computing indicators, or null on failure.
 * Cache TTL is 1 day since bar data only changes once per trading day.
 */
async function getCachedYahooBars(symbol: string): Promise<YahooBar[] | null> {
  const cacheKey = `yahoo-bars:${symbol.toUpperCase()}`;

  await connectToDatabase();

  // ── Check cache ──────────────────────────────────────────────────────
  const cached = await Cache.findOne({ cacheKey }).lean();
  if (cached) {
    console.log(`⚡ Yahoo Bars Cache HIT: ${cacheKey}`);
    return JSON.parse(cached.result) as YahooBar[];
  }

  // ── Fetch from Yahoo ─────────────────────────────────────────────────
  const bars = await getYahooHistoricalBars(symbol);
  if (!bars) return null;

  // ── Persist to cache with 1-day TTL ──────────────────────────────────
  await Cache.deleteOne({ cacheKey });
  await Cache.create({
    cacheKey,
    type: "yahoo-bars",
    result: JSON.stringify(bars),
    input: JSON.stringify({ symbol }),
    expireAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day
  });

  console.log(`💾 Yahoo Bars Cache SAVED: ${cacheKey} (1d TTL)`);
  return bars;
}

// ── Technical Indicator Calculations (TA-Lib) ────────────────────────

/** Promisified talib.execute for use in async functions */
function talibExec(
  params: talib.ExecuteParameters,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    talib.execute(
      params,
      (err: talib.ExecuteError | null, result?: talib.ExecuteResult) => {
        if (err) reject(err);
        else resolve(result as unknown as Record<string, unknown>);
      },
    );
  });
}

/** Extract the last value from a talib output array */
function lastOf(arr: number[] | undefined, nbElement: number): number | null {
  if (!arr || nbElement === 0) return null;
  return arr[nbElement - 1] ?? null;
}

/** Simple Moving Average via TA-Lib */
async function calcSMA(
  closes: number[],
  period: number,
): Promise<number | null> {
  if (closes.length < period) return null;
  const res = await talibExec({
    name: "SMA",
    startIdx: 0,
    endIdx: closes.length - 1,
    inReal: closes,
    optInTimePeriod: period,
  });
  return lastOf(
    (res.result as Record<string, number[]>)?.outReal,
    res.nbElement as number,
  );
}

/** RSI via TA-Lib (Wilder's smoothed method) */
async function calcRSI(
  closes: number[],
  period: number,
): Promise<number | null> {
  if (closes.length < period + 1) return null;
  const res = await talibExec({
    name: "RSI",
    startIdx: 0,
    endIdx: closes.length - 1,
    inReal: closes,
    optInTimePeriod: period,
  });
  return lastOf(
    (res.result as Record<string, number[]>)?.outReal,
    res.nbElement as number,
  );
}

/** MACD (12, 26, 9) via TA-Lib.
 *
 *  Formula:
 *    MACD Line  = EMA(close, 12) - EMA(close, 26)
 *    Signal     = EMA(MACD Line, 9)
 *    Histogram  = MACD Line - Signal
 *
 *  Bullish when MACD Line > Signal, bearish when MACD Line < Signal.
 */
async function calcMACD(closes: number[]): Promise<{
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}> {
  if (closes.length < 26) return { macd: null, signal: null, histogram: null };

  const res = await talibExec({
    name: "MACD",
    startIdx: 0,
    endIdx: closes.length - 1,
    inReal: closes,
    optInFastPeriod: 12,
    optInSlowPeriod: 26,
    optInSignalPeriod: 9,
  });

  const r = res.result as Record<string, number[]>;
  const nb = res.nbElement as number;

  return {
    macd: lastOf(r.outMACD, nb),
    signal: lastOf(r.outMACDSignal, nb),
    histogram: lastOf(r.outMACDHist, nb),
  };
}

/** KDJ (9, 3, 3) — manual calculation matching the standard formula.
 *
 *  RSV(n) = (close - LL9) / (HH9 - LL9) × 100
 *  K(n)   = 2/3 × K(n-1) + 1/3 × RSV(n)
 *  D(n)   = 2/3 × D(n-1) + 1/3 × K(n)
 *  J(n)   = 3 × K(n) - 2 × D(n)
 *
 *  Initial K = D = 50.
 */
async function calcKDJ(
  closes: number[],
  highs: number[],
  lows: number[],
): Promise<{ k: number | null; d: number | null; j: number | null }> {
  const period = 9;
  if (closes.length < period) return { k: null, d: null, j: null };

  let k = 50;
  let d = 50;

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) continue; // not enough data yet

    const start = i - period + 1;
    const hh = Math.max(...highs.slice(start, i + 1));
    const ll = Math.min(...lows.slice(start, i + 1));
    const range = hh - ll;

    const rsv = range > 0 ? ((closes[i] - ll) / range) * 100 : 50;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
  }

  const j = 3 * k - 2 * d;
  return { k, d, j };
}

/** Bollinger Bands via TA-Lib BBANDS: middle = SMA(20), upper/lower = ±2σ */
async function calcBollingerBands(closes: number[]): Promise<{
  upper: number | null;
  middle: number | null;
  lower: number | null;
}> {
  if (closes.length < 20) return { upper: null, middle: null, lower: null };

  const res = await talibExec({
    name: "BBANDS",
    startIdx: 0,
    endIdx: closes.length - 1,
    inReal: closes,
    optInTimePeriod: 20,
    optInNbDevUp: 2,
    optInNbDevDn: 2,
    optInMAType: 0, // SMA
  });

  const r = res.result as Record<string, number[]>;
  const nb = res.nbElement as number;

  return {
    upper: lastOf(r.outRealUpperBand, nb),
    middle: lastOf(r.outRealMiddleBand, nb),
    lower: lastOf(r.outRealLowerBand, nb),
  };
}

/** On-Balance Volume via TA-Lib OBV */
async function calcOBV(
  closes: number[],
  volumes: number[],
): Promise<number | null> {
  if (closes.length < 2) return null;

  const res = await talibExec({
    name: "OBV",
    startIdx: 0,
    endIdx: closes.length - 1,
    inReal: closes,
    volume: volumes,
  });

  return lastOf(
    (res.result as Record<string, number[]>)?.outReal,
    res.nbElement as number,
  );
}

// ── Aggregate ────────────────────────────────────────────────────────

async function getTechnicalIndicators(
  symbol: string,
): Promise<TechnicalIndicators> {
  const [bars, quote] = await Promise.all([
    getCachedYahooBars(symbol),
    getYahooQuote(symbol),
  ]);

  const currentPrice = quote?.regularMarketPrice ?? null;

  if (!bars || bars.length < 20) {
    return {
      currentPrice,
      rsi7: null,
      rsi14: null,
      rsi21: null,
      sma5: null,
      sma10: null,
      sma20: null,
      sma50: null,
      sma200: null,
      macd: null,
      k: null,
      d: null,
      j: null,
      bbUpper: null,
      bbMiddle: null,
      bbLower: null,
      obv: null,
      volume: null,
    };
  }

  const closes = bars
    .map((b) => b.close)
    .filter((v): v is number => v !== null);
  const highs = bars.map((b) => b.high).filter((v): v is number => v !== null);
  const lows = bars.map((b) => b.low).filter((v): v is number => v !== null);
  const volumes = bars
    .map((b) => b.volume)
    .filter((v): v is number => v !== null);

  const [
    rsi7,
    rsi14,
    rsi21,
    sma5,
    sma10,
    sma20,
    sma50,
    sma200,
    macd,
    kdj,
    bb,
    obv,
  ] = await Promise.all([
    calcRSI(closes, 7),
    calcRSI(closes, 14),
    calcRSI(closes, 21),
    calcSMA(closes, 5),
    calcSMA(closes, 10),
    calcSMA(closes, 20),
    calcSMA(closes, 50),
    calcSMA(closes, 200),
    calcMACD(closes),
    calcKDJ(closes, highs, lows),
    calcBollingerBands(closes),
    calcOBV(closes, volumes),
  ]);

  return {
    currentPrice,
    rsi7,
    rsi14,
    rsi21,
    sma5,
    sma10,
    sma20,
    sma50,
    sma200,
    macd,
    k: kdj.k,
    d: kdj.d,
    j: kdj.j,
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    obv,
    volume: volumes[volumes.length - 1] ?? null,
  };
}

function formatTechnicalSummary(ti: TechnicalIndicators): string {
  const lines: string[] = [];

  if (ti.rsi7 !== null) lines.push(`RSI(7): ${ti.rsi7.toFixed(1)}`);
  if (ti.rsi14 !== null) lines.push(`RSI(14): ${ti.rsi14.toFixed(1)}`);
  if (ti.rsi21 !== null) lines.push(`RSI(21): ${ti.rsi21.toFixed(1)}`);
  if (ti.sma5 !== null) lines.push(`SMA(5): $${ti.sma5.toFixed(2)}`);
  if (ti.sma10 !== null) lines.push(`SMA(10): $${ti.sma10.toFixed(2)}`);
  if (ti.sma20 !== null) lines.push(`SMA(20): $${ti.sma20.toFixed(2)}`);
  if (ti.sma50 !== null) lines.push(`SMA(50): $${ti.sma50.toFixed(2)}`);
  if (ti.sma200 !== null) lines.push(`SMA(200): $${ti.sma200.toFixed(2)}`);
  const macd = ti.macd;
  if (macd && macd.macd !== null && macd.signal !== null) {
    lines.push(
      `MACD: ${macd.macd.toFixed(2)} / Signal: ${macd.signal.toFixed(2)} / Hist: ${(macd.histogram ?? 0).toFixed(2)}`,
    );
  }
  if (ti.k !== null && ti.d !== null && ti.j !== null) {
    lines.push(
      `KDJ: K=${ti.k.toFixed(1)} D=${ti.d.toFixed(1)} J=${ti.j.toFixed(1)}`,
    );
  }
  if (ti.bbUpper !== null && ti.bbMiddle !== null && ti.bbLower !== null) {
    lines.push(
      `BB(20,2): Upper $${ti.bbUpper.toFixed(2)} Mid $${ti.bbMiddle.toFixed(2)} Lower $${ti.bbLower.toFixed(2)}`,
    );
  }
  if (ti.obv !== null) {
    const absVal = Math.abs(ti.obv);
    const sign = ti.obv < 0 ? "-" : "";
    const obv =
      absVal >= 1_000_000
        ? `${sign}${(absVal / 1_000_000).toFixed(1)}M`
        : absVal >= 1_000
          ? `${sign}${(absVal / 1_000).toFixed(0)}K`
          : String(ti.obv);
    lines.push(`OBV: ${obv}`);
  }
  if (ti.volume !== null) {
    const vol =
      ti.volume >= 1_000_000
        ? `${(ti.volume / 1_000_000).toFixed(1)}M`
        : ti.volume >= 1_000
          ? `${(ti.volume / 1_000).toFixed(0)}K`
          : String(ti.volume);
    lines.push(`Volume: ${vol}`);
  }

  return lines.length > 0 ? lines.join("\n") : "N/A";
}

// ── Prompts ──────────────────────────────────────────────────────────

const MARKET_SUMMARY_PROMPT = `You are a financial market analyst. Based on the following recent market news, write a concise but insightful market summary (3-5 sentences) for a retail investor dashboard.

Key requirements:
- Be factual and data-driven
- Highlight the most important market movements or themes
- Keep tone professional but accessible
- Do NOT use markdown, headings, or bullet points — just plain paragraphs
- Aim for 40-70 words total

Recent news:
{{newsData}}

Market Summary:`;

const STOCK_ANALYSIS_PROMPT =
  "You are a financial market analyst. Keep it clear, educational, and concise.\n\n" +
  "Your analysis for {{symbol}} ({{companyName}}):\n" +
  "Current price: ${{price}} ({{change}}, {{changePercent}}%%)\n" +
  "Market cap: {{marketCap}}\n\n" +
  "Technical Indicators:\n" +
  "{{technicalIndicators}}\n\n" +
  "Recent news:\n" +
  "{{newsDigest}}\n\n" +
  'Write 3-4 plain sentences. Start with "Score: X/10 — Bullish/Bearish/Neutral". Look at all the indicators together and explain what they collectively imply about the stock\'s direction (e.g. "the indicators point to strong upward momentum — RSI is bullish but not overbought, MACD is positive, and the stock is trending above its key averages"). Prioritize technical indicators, then price, then news. No markdown. No headings.';

// ── Cache helpers ────────────────────────────────────────────────────

/**
 * Call the AI provider with DB caching (TTL 1 hour).
 */
async function callAIWithCache(
  cacheKey: string,
  buildPrompt: () => Promise<string>,
  forceRefresh: boolean,
): Promise<string> {
  const config = getProviderConfig();

  await connectToDatabase();

  if (!forceRefresh) {
    const cached = await Cache.findOne({ cacheKey }).lean();
    if (cached) {
      console.log(`⚡ AI Cache HIT: ${cacheKey}`);
      return cached.result;
    }
  }

  await Cache.deleteOne({ cacheKey });

  const prompt = await buildPrompt();
  const result = await callAIProvider(prompt);

  const trimmed = result.trim();
  if (!trimmed) throw new Error("AI returned empty response");

  await Cache.create({
    cacheKey,
    type: "ai",
    result: trimmed,
    input: JSON.stringify({
      prompt,
      model: config.model,
      provider: config.name,
      baseUrl: config.baseUrl,
    }),
    expireAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day
  });

  console.log(
    `💾 AI Cache SAVED: ${cacheKey} (${config.name}/${config.model})`,
  );
  return trimmed;
}

// ── Public actions ───────────────────────────────────────────────────

export async function getAIMarketSummary(
  forceRefresh = false,
): Promise<string> {
  try {
    return await callAIWithCache(
      "market-summary",
      async () => {
        const articles = await getNews();
        if (!articles || articles.length === 0) {
          throw new Error("No news available");
        }
        const newsDigest = articles
          .slice(0, 6)
          .map(
            (a) =>
              `- [${a.source}] ${a.headline}${a.summary ? ` — ${a.summary.slice(0, 120)}` : ""}`,
          )
          .join("\n");
        return MARKET_SUMMARY_PROMPT.replace("{{newsData}}", newsDigest);
      },
      forceRefresh,
    );
  } catch (error) {
    console.error("Failed to generate AI market summary", error);
    return "Markets are quiet today. Check back later for the latest updates.";
  }
}

export async function getAIStockAnalysis(
  symbol: string,
  forceRefresh = false,
): Promise<string> {
  try {
    const sym = symbol.toUpperCase();

    return await callAIWithCache(
      `stock-analysis:${sym}`,
      async () => {
        const [quote, profile, articles] = await Promise.all([
          getYahooQuote(sym),
          getYahooCompanyProfile(sym),
          getNews([sym]).catch(() => [] as MarketNewsArticle[]),
        ]);

        const price = quote?.regularMarketPrice ?? 0;
        const change = quote?.regularMarketChange ?? 0;
        const changePercent = quote?.regularMarketChangePercent ?? 0;
        const companyName = profile?.name || sym;
        const marketCap = profile?.marketCap
          ? `$${(profile.marketCap / 1e9).toFixed(2)}B`
          : "N/A";

        // Fetch & calculate technical indicators from Alpaca
        const technicalIndicators = await getTechnicalIndicators(sym);
        const taSummary = formatTechnicalSummary(technicalIndicators);

        const newsDigest =
          (articles as MarketNewsArticle[])
            ?.slice(0, 4)
            .map(
              (a) =>
                `- ${a.headline}${a.summary ? `: ${a.summary.slice(0, 100)}` : ""}`,
            )
            .join("\n") || "No recent news available.";

        return STOCK_ANALYSIS_PROMPT.replace("{{symbol}}", sym)
          .replace("{{companyName}}", companyName)
          .replace("{{price}}", price.toFixed(2))
          .replace("{{change}}", change.toFixed(2))
          .replace("{{changePercent}}", changePercent.toFixed(2))
          .replace("{{marketCap}}", marketCap)
          .replace("{{technicalIndicators}}", taSummary)
          .replace("{{newsDigest}}", newsDigest);
      },
      forceRefresh,
    );
  } catch (error) {
    console.error(`Failed to generate AI analysis for ${symbol}`, error);
    return "Analysis is currently unavailable. Please check back shortly.";
  }
}

/**
 * Fetch raw technical indicators data for a stock (for UI display).
 * Returns null when no data is available (e.g. missing API keys),
 * so the caller can show a helpful fallback message.
 */
export async function getStockTechnicalData(
  symbol: string,
  forceRefresh = false,
): Promise<TechnicalIndicators | null> {
  const cacheKey = `tech-data:${symbol.toUpperCase()}`;
  try {
    // Check cache (unless forcing refresh)
    await connectToDatabase();
    if (!forceRefresh) {
      const cached = await Cache.findOne({ cacheKey }).lean();
      if (cached) {
        console.log(`⚡ Tech Data Cache HIT: ${cacheKey}`);
        return JSON.parse(cached.result) as TechnicalIndicators;
      }
    }

    // Fetch fresh
    const sym = symbol.toUpperCase();
    const result = await getTechnicalIndicators(sym);

    // Normalise any fields that might be missing from stale cache entries
    result.sma5 ??= null;
    result.sma10 ??= null;
    result.rsi7 ??= null;
    result.rsi14 ??= null;
    result.rsi21 ??= null;
    result.k ??= null;
    result.d ??= null;
    result.j ??= null;
    result.bbUpper ??= null;
    result.bbMiddle ??= null;
    result.bbLower ??= null;
    result.obv ??= null;

    // If all core fields are null, nothing useful was fetched
    if (
      result.currentPrice === null &&
      result.rsi7 === null &&
      result.rsi14 === null &&
      result.rsi21 === null &&
      result.sma20 === null &&
      result.sma50 === null &&
      result.sma200 === null &&
      result.macd === null
    ) {
      console.warn(
        `⚠️ Tech Data unavailable for ${symbol}: all indicators null (check Alpaca keys / data feed)`,
      );
      return null;
    }

    // Delete stale entry, then persist
    await Cache.deleteOne({ cacheKey });
    await Cache.create({
      cacheKey,
      type: "tech-indicators",
      result: JSON.stringify(result),
      input: JSON.stringify({
        provider: "alpaca",
        baseUrl: "https://data.alpaca.markets/v2",
      }),
      expireAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day
    });

    console.log(`💾 Tech Data Cache SAVED: ${cacheKey}`);
    return result;
  } catch (error) {
    console.error(`Failed to fetch technical data for ${symbol}`, error);
    return null;
  }
}

/**
 * Ask a follow-up question in the context of a previous AI response, or a general question.
 * @param context - The original AI analysis text that provides helpful background
 * @param question - The user's follow-up question
 */
export async function askFollowUp(
  context: string,
  question: string,
): Promise<string> {
  try {
    const prompt =
      "You are a financial market analyst.\n\n" +
      (context
        ? "Relevant context (previous analysis):\n" + context + "\n\n"
        : "") +
      "User question:\n" +
      question +
      "\n\n" +
      "Answer clearly and concisely (2-4 sentences). Use the context if helpful, but you can also answer general investment questions. Be specific with numbers when referencing data. No markdown.";

    const result = await callAIProvider(prompt);
    return result.trim();
  } catch (error) {
    console.error("Failed to answer follow-up question:", error);
    return "Sorry, I couldn't process your question. Please try again.";
  }
}

/**
 * Generate an AI-powered plain-language summary of the current technical
 * indicators for a stock. The result is cached for 1 day.
 */
export async function getTechnicalSummary(
  symbol: string,
  forceRefresh = false,
): Promise<string> {
  try {
    const sym = symbol.toUpperCase();

    return await callAIWithCache(
      `ta-summary:${sym}`,
      async () => {
        const ti = await getTechnicalIndicators(sym);

        // Build a quick reference of indicator readings with interpretation cues
        const lines: string[] = [];

        if (ti.rsi7 !== null) {
          const state =
            ti.rsi7 >= 70
              ? "overbought"
              : ti.rsi7 <= 30
                ? "oversold"
                : "neutral";
          lines.push(`RSI(7): ${ti.rsi7.toFixed(1)} (${state})`);
        }
        if (ti.rsi14 !== null) {
          const state =
            ti.rsi14 >= 70
              ? "overbought"
              : ti.rsi14 <= 30
                ? "oversold"
                : "neutral";
          lines.push(`RSI(14): ${ti.rsi14.toFixed(1)} (${state})`);
        }
        if (ti.rsi21 !== null) {
          const state =
            ti.rsi21 >= 70
              ? "overbought"
              : ti.rsi21 <= 30
                ? "oversold"
                : "neutral";
          lines.push(`RSI(21): ${ti.rsi21.toFixed(1)} (${state})`);
        }

        if (ti.sma5 !== null && ti.currentPrice !== null) {
          lines.push(
            `SMA(5): $${ti.sma5.toFixed(2)} (price ${ti.currentPrice >= ti.sma5 ? "above" : "below"})`,
          );
        }
        if (ti.sma10 !== null && ti.currentPrice !== null) {
          lines.push(
            `SMA(10): $${ti.sma10.toFixed(2)} (price ${ti.currentPrice >= ti.sma10 ? "above" : "below"})`,
          );
        }
        if (ti.sma20 !== null && ti.currentPrice !== null) {
          lines.push(
            `SMA(20): $${ti.sma20.toFixed(2)} (price ${ti.currentPrice >= ti.sma20 ? "above" : "below"})`,
          );
        }
        if (ti.sma50 !== null && ti.currentPrice !== null) {
          lines.push(
            `SMA(50): $${ti.sma50.toFixed(2)} (price ${ti.currentPrice >= ti.sma50 ? "above" : "below"})`,
          );
        }
        if (ti.sma200 !== null && ti.currentPrice !== null) {
          lines.push(
            `SMA(200): $${ti.sma200.toFixed(2)} (price ${ti.currentPrice >= ti.sma200 ? "above" : "below"})`,
          );
        }

        const macd = ti.macd;
        if (macd && macd.macd !== null && macd.signal !== null) {
          lines.push(
            `MACD: ${macd.macd.toFixed(2)} / Signal: ${macd.signal.toFixed(2)} (${macd.macd > macd.signal ? "bullish" : "bearish"})`,
          );
        }

        if (ti.k !== null && ti.d !== null && ti.j !== null) {
          lines.push(
            `KDJ: K=${ti.k.toFixed(1)} D=${ti.d.toFixed(1)} J=${ti.j.toFixed(1)} (K ${ti.k > ti.d ? "above" : "below"} D)`,
          );
        }

        if (
          ti.bbUpper !== null &&
          ti.bbMiddle !== null &&
          ti.bbLower !== null &&
          ti.currentPrice !== null
        ) {
          const bbPos =
            ti.currentPrice >= ti.bbUpper
              ? "above upper band"
              : ti.currentPrice <= ti.bbLower
                ? "below lower band"
                : "within bands";
          lines.push(
            `Bollinger Bands: Upper $${ti.bbUpper.toFixed(2)} Mid $${ti.bbMiddle.toFixed(2)} Lower $${ti.bbLower.toFixed(2)} (price ${bbPos})`,
          );
        }

        if (ti.obv !== null) {
          lines.push(
            `OBV: ${ti.obv >= 0 ? "positive" : "negative"} (volume flow ${ti.obv >= 0 ? "in" : "out"})`,
          );
        }

        const prompt =
          "You are a technical analysis teacher. Based on the following indicator readings, " +
          "write 2-3 plain sentences explaining what they collectively suggest about the stock's " +
          "current technical state. Be specific with numbers. Use simple language a beginner could " +
          "understand. No markdown. No headings.\n\n" +
          "Indicator readings:\n" +
          (lines.length > 0 ? lines.join("\n") : "No indicators available.");

        return prompt;
      },
      forceRefresh,
    );
  } catch (error) {
    console.error(`Failed to generate TA summary for ${symbol}:`, error);
    return "Technical summary is currently unavailable.";
  }
}
