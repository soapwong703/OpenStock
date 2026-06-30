import { Schema, model, models, type Document, type Model } from "mongoose";

export interface IAiCache extends Document {
  /** Unique key to identify the cached entry (e.g. "market-summary", "stock-analysis:AAPL") */
  cacheKey: string;
  prompt: string;
  result: string;
  model: string;
  provider: string;
  baseUrl: string;
  createdAt: Date;
}

const AiCacheSchema = new Schema<IAiCache>(
  {
    cacheKey: { type: String, required: true, unique: true, index: true },
    prompt: { type: String, required: true },
    result: { type: String, required: true },
    model: { type: String, required: true },
    provider: { type: String, required: true },
    baseUrl: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// TTL index: documents expire after 3600 seconds (1 hour)
AiCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });

export const AiCache: Model<IAiCache> =
  (models?.AiCache as Model<IAiCache>) ||
  model<IAiCache>("AiCache", AiCacheSchema);
