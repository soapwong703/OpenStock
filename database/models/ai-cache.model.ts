import { Schema, model, models, type Document, type Model } from "mongoose";

export interface ICache extends Document {
  /** Unique key for the cached entry (e.g. "market-summary", "stock-analysis:AAPL", "tech-data:AAPL") */
  cacheKey: string;
  /** What kind of data this is — free string (e.g. "ai", "tech-indicators", "alpaca-bars") */
  type: string;
  /** The cached payload as a JSON string */
  result: string;
  /** Arbitrary input metadata as a JSON string (prompt, model, provider, baseUrl, etc.) */
  input: string;
  createdAt: Date;
  /** When this cache entry should be auto-deleted by MongoDB TTL index.
   *  Set explicitly to control per-document TTL (e.g. 1 hour for AI, 1 day for bars). */
  expireAt: Date;
}

const CacheSchema = new Schema<ICache>(
  {
    cacheKey: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true },
    result: { type: String, required: true },
    input: { type: String, required: true, default: "{}" },
    createdAt: { type: Date, default: Date.now },
    expireAt: { type: Date, required: true },
  },
  { timestamps: false },
);

// TTL index on expireAt for per-document expiration control.
// To set a custom TTL, write a future date into expireAt.
CacheSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const Cache: Model<ICache> =
  (models?.Cache as Model<ICache>) || model<ICache>("Cache", CacheSchema);
