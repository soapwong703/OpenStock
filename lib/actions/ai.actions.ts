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
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  macd: {
    macd: number | null;
    signal: number | null;
    histogram: number | null;
  } | null;
  vwap: number | null;
  volume: number | null;
}

// ── Alpaca Market Data ───────────────────────────────────────────────

/**
 * Fetch daily bars for a symbol using the Alpaca SDK.
 * Returns at least 250 bars for computing indicators, or null on failure.
 */
async function fetchAlpacaBars(symbol: string) {
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

// ── Aggregate ────────────────────────────────────────────────────────

async function getTechnicalIndicators(
  symbol: string,
): Promise<TechnicalIndicators> {
  const bars = await fetchAlpacaBars(symbol);
  if (!bars || bars.length < 20) {
    return {
      rsi: null,
      sma20: null,
      sma50: null,
      sma200: null,
      macd: null,
      vwap: null,
      volume: null,
    };
  }

  const closes = bars.map((b) => b.ClosePrice);
  const volumes = bars.map((b) => b.Volume);

  const [rsi, sma20, sma50, sma200, macd] = await Promise.all([
    calcRSI(closes, 14),
    calcSMA(closes, 20),
    calcSMA(closes, 50),
    calcSMA(closes, 200),
    calcMACD(closes),
  ]);

  return {
    rsi,
    sma20,
    sma50,
    sma200,
    macd,
    vwap: bars[bars.length - 1]?.VWAP ?? null,
    volume: volumes[volumes.length - 1] ?? null,
  };
}

function formatTechnicalSummary(ti: TechnicalIndicators): string {
  const lines: string[] = [];

  if (ti.rsi !== null) lines.push(`RSI(14): ${ti.rsi.toFixed(1)}`);
  if (ti.sma20 !== null) lines.push(`SMA(20): $${ti.sma20.toFixed(2)}`);
  if (ti.sma50 !== null) lines.push(`SMA(50): $${ti.sma50.toFixed(2)}`);
  if (ti.sma200 !== null) lines.push(`SMA(200): $${ti.sma200.toFixed(2)}`);
  const macd = ti.macd;
  if (macd && macd.macd !== null && macd.signal !== null) {
    lines.push(
      `MACD: ${macd.macd.toFixed(2)} / Signal: ${macd.signal.toFixed(2)} / Hist: ${(macd.histogram ?? 0).toFixed(2)}`,
    );
  }
  if (ti.vwap !== null) lines.push(`VWAP: $${ti.vwap.toFixed(2)}`);
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
  "You are a financial analyst. Provide a concise stock insight for {{symbol}} ({{companyName}}).\n\n" +
  "Current price: ${{price}}\n" +
  "Change: {{change}} ({{changePercent}}%)\n" +
  "Market cap: {{marketCap}}\n\n" +
  "Technical Indicators:\n" +
  "{{technicalIndicators}}\n\n" +
  "Recent news about this company:\n" +
  "{{newsDigest}}\n\n" +
  "Write 3-4 concise sentences covering:\n" +
  "1. Recent price action relative to key moving averages (SMA20/50/200)\n" +
  "2. Momentum signals from RSI and MACD\n" +
  "3. Key news or developments\n" +
  "4. Brief outlook or watchpoint\n\n" +
  "Requirements:\n" +
  "- Be factual and specific (use numbers from technical indicators when available)\n" +
  "- Do NOT use markdown, headings, or bullet points\n" +
  "- Keep it to 3-4 plain sentences (50-80 words total)\n" +
  "- Tone: professional, objective, helpful for a retail investor\n" +
  "- If technical indicators are not available, just focus on price action and news — do NOT mention missing data";

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
): Promise<TechnicalIndicators | null> {
  const cacheKey = `tech-data:${symbol.toUpperCase()}`;
  try {
    // Check cache
    await connectToDatabase();
    const cached = await Cache.findOne({ cacheKey }).lean();
    if (cached) {
      console.log(`⚡ Tech Data Cache HIT: ${cacheKey}`);
      return JSON.parse(cached.result) as TechnicalIndicators;
    }

    // Fetch fresh
    const sym = symbol.toUpperCase();
    const result = await getTechnicalIndicators(sym);

    // If all core fields are null, nothing useful was fetched
    if (
      result.rsi === null &&
      result.sma20 === null &&
      result.sma50 === null &&
      result.sma200 === null &&
      result.macd === null &&
      result.vwap === null &&
      result.volume === null
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
    });

    console.log(`💾 Tech Data Cache SAVED: ${cacheKey}`);
    return result;
  } catch (error) {
    console.error(`Failed to fetch technical data for ${symbol}`, error);
    return null;
  }
}
