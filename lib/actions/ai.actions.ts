"use server";

import { callAIProvider, getProviderConfig } from "@/lib/ai-provider";
import {
  getNews,
  getQuote,
  getCompanyProfile,
} from "@/lib/actions/finnhub.actions";
import { connectToDatabase } from "@/database/mongoose";
import { Cache } from "@/database/models/ai-cache.model";
import talib from "talib";
import Alpaca from "@alpacahq/alpaca-trade-api";

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

/** Minimal shape of an Alpaca bar (returned by getMultiBarsV2). */
type AlpacaBar =
  import("@alpacahq/alpaca-trade-api/dist/resources/datav2/entityv2").AlpacaBar;

// ── Alpaca Market Data (cached, 1-day TTL) ───────────────────────────

/**
 * Fetch daily bars for a symbol using the Alpaca SDK, with DB caching.
 * Returns at least 250 bars for computing indicators, or null on failure.
 * Cache TTL is 1 day since bar data only changes once per trading day.
 */
async function getCachedAlpacaBars(
  symbol: string,
): Promise<AlpacaBar[] | null> {
  const cacheKey = `alpaca-bars:${symbol.toUpperCase()}`;

  await connectToDatabase();

  // ── Check cache ──────────────────────────────────────────────────────
  const cached = await Cache.findOne({ cacheKey }).lean();
  if (cached) {
    console.log(`⚡ Alpaca Bars Cache HIT: ${cacheKey}`);
    return JSON.parse(cached.result) as AlpacaBar[];
  }

  // ── Fetch from Alpaca ────────────────────────────────────────────────
  try {
    const key = process.env.ALPACA_API_KEY;
    const secret = process.env.ALPACA_SECRET_KEY;
    if (!key || !secret) {
      console.error("⚠️ Alpaca: Missing API keys");
      return null;
    }

    const alpaca = new Alpaca({
      keyId: key,
      secretKey: secret,
      paper: true,
    });

    // Explicit date range to ensure we get enough bars
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 2); // 2 years back

    console.log(
      `📡 Alpaca bars ${symbol}: fetching from ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
    );

    const barsMap = await alpaca.getMultiBarsV2([symbol], {
      timeframe: "1Day",
      limit: 500,
      adjustment: "split",
      feed: "iex", // explicit — free tier needs IEX feed
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    });

    const bars = barsMap.get(symbol.toUpperCase());
    if (!bars || bars.length === 0) {
      console.log(`📡 Alpaca bars ${symbol}: empty response`);
      console.log(`   Map keys:`, [...barsMap.keys()]);
      return null;
    }

    console.log(`✅ Alpaca bars ${symbol}: ${bars.length} days`);

    // ── Persist to cache with 1-day TTL ──────────────────────────────────
    await Cache.deleteOne({ cacheKey });
    await Cache.create({
      cacheKey,
      type: "alpaca-bars",
      result: JSON.stringify(bars),
      input: JSON.stringify({ symbol }),
      expireAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day
    });

    console.log(`💾 Alpaca Bars Cache SAVED: ${cacheKey} (1d TTL)`);
    return bars;
  } catch (e) {
    console.error(`❌ Alpaca bars failed for ${symbol}:`, e);
    if (e instanceof Error) {
      console.error(`   Message: ${e.message}`);
      console.error(`   Stack: ${e.stack?.split("\n").slice(0, 3).join("\n")}`);
    }
    return null;
  }
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

/** MACD via TA-Lib: returns MACD line, signal line, and histogram */
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

/** KDJ via TA-Lib's STOCH: K = fast %K, D = slow %D, J = 3*D - 2*K */
async function calcKDJ(
  closes: number[],
  highs: number[],
  lows: number[],
): Promise<{ k: number | null; d: number | null; j: number | null }> {
  if (closes.length < 9) return { k: null, d: null, j: null };

  const res = await talibExec({
    name: "STOCH",
    startIdx: 0,
    endIdx: closes.length - 1,
    high: highs,
    low: lows,
    close: closes,
    optInFastK_Period: 9,
    optInSlowK_Period: 3,
    optInSlowK_MAType: 0, // SMA
    optInSlowD_Period: 3,
    optInSlowD_MAType: 0, // SMA
  });

  const r = res.result as Record<string, number[]>;
  const nb = res.nbElement as number;

  const k = lastOf(r.outSlowK, nb);
  const d = lastOf(r.outSlowD, nb);
  const j = k !== null && d !== null ? 3 * d - 2 * k : null;

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
    getCachedAlpacaBars(symbol),
    getQuote(symbol),
  ]);

  const currentPrice = quote?.c ?? null;

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

  const closes = bars.map((b) => b.ClosePrice);
  const highs = bars.map((b) => b.HighPrice);
  const lows = bars.map((b) => b.LowPrice);
  const volumes = bars.map((b) => b.Volume);

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
    expireAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
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
          getQuote(sym),
          getCompanyProfile(sym),
          getNews([sym]).catch(() => [] as MarketNewsArticle[]),
        ]);

        const price = quote?.c ?? 0;
        const change = quote?.d ?? 0;
        const changePercent = quote?.dp ?? 0;
        const companyName = profile?.name || sym;
        const marketCap = profile?.marketCapitalization
          ? `$${(profile.marketCapitalization / 1e9).toFixed(2)}B`
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
      expireAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
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
