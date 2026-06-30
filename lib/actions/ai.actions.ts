"use server";

import { callAIProvider, getProviderConfig } from "@/lib/ai-provider";
import {
  getNews,
  getQuote,
  getCompanyProfile,
} from "@/lib/actions/finnhub.actions";
import { connectToDatabase } from "@/database/mongoose";
import { AiCache } from "@/database/models/ai-cache.model";

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
  "Recent news about this company:\n" +
  "{{newsDigest}}\n\n" +
  "Write 3-4 concise sentences covering:\n" +
  "1. Recent price action and what it suggests\n" +
  "2. Key news or developments\n" +
  "3. Brief outlook or watchpoint\n\n" +
  "Requirements:\n" +
  "- Be factual and specific (use numbers)\n" +
  "- Do NOT use markdown, headings, or bullet points\n" +
  "- Keep it to 3-4 plain sentences (50-80 words total)\n" +
  "- Tone: professional, objective, helpful for a retail investor";

// ── Cache helpers ────────────────────────────────────────────────────

/**
 * Call the AI provider with DB caching (TTL 1 hour).
 *
 * @param cacheKey  - Unique key for the cache entry
 * @param buildPrompt - Async callback that returns the final prompt string
 * @param forceRefresh - If true, skip cache and force a fresh generation
 */
async function callAIWithCache(
  cacheKey: string,
  buildPrompt: () => Promise<string>,
  forceRefresh: boolean,
): Promise<string> {
  const config = getProviderConfig();

  // Connect and check cache
  await connectToDatabase();

  if (!forceRefresh) {
    const cached = await AiCache.findOne({ cacheKey }).lean();
    if (cached) {
      console.log(`⚡ AI Cache HIT: ${cacheKey}`);
      return cached.result;
    }
  }

  // Delete any stale entry before regenerating
  await AiCache.deleteOne({ cacheKey });

  // Generate the prompt and call the AI provider
  const prompt = await buildPrompt();
  const result = await callAIProvider(prompt);

  const trimmed = result.trim();
  if (!trimmed) throw new Error("AI returned empty response");

  // Persist to cache
  await AiCache.create({
    cacheKey,
    prompt,
    result: trimmed,
    model: config.model,
    provider: config.name,
    baseUrl: config.baseUrl,
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
          .replace("{{newsDigest}}", newsDigest);
      },
      forceRefresh,
    );
  } catch (error) {
    console.error(`Failed to generate AI analysis for ${symbol}`, error);
    return "Analysis is currently unavailable. Please check back shortly.";
  }
}
