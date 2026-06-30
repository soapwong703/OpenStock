import { Schema, model, models, type Document, type Model } from "mongoose";

/** Well-known cache types — extend as needed */
export type CacheType = "ai" | "tech-indicators";

export interface ICache extends Document {
  /** Unique key for the cached entry (e.g. "market-summary", "stock-analysis:AAPL", "tech-data:AAPL") */
  cacheKey: string;
  /** What kind of data this is ("ai", "tech-indicators", etc.) */
  type: string;
  /** The cached payload as a JSON string */
  result: string;
  /** Arbitrary input metadata as a JSON string (prompt, model, provider, baseUrl, etc.) */
  input: string;
  createdAt: Date;
}

const CacheSchema = new Schema<ICache>(
  {
    cacheKey: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true },
    result: { type: String, required: true },
    input: { type: String, required: true, default: "{}" },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// TTL index: documents expire after 3600 seconds (1 hour)
CacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });

export const Cache: Model<ICache> =
  (models?.Cache as Model<ICache>) || model<ICache>("Cache", CacheSchema);
