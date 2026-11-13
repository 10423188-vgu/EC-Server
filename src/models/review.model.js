import mongoose from "mongoose";
import { randomUUID } from "crypto";

const reviewImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    altText: { type: String, default: null },
  },
  { _id: false }
);

const adminResponseSchema = new mongoose.Schema(
  {
    body: { type: String, required: true },
    respondedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    productId: { type: String, required: true },

    userId: { type: String, required: true },
    userName: { type: String, required: true },
    userAvatar: { type: String, default: null },

    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    images: { type: [reviewImageSchema], default: [] },

    isVerifiedPurchase: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "APPROVED",
    },

    // why: select:false keeps these out of default query results — avoids shipping huge
    // voter-id arrays on every review fetch; select them explicitly only where needed
    helpfulVoters: { type: [String], default: [], select: false },
    notHelpfulVoters: { type: [String], default: [], select: false },
    helpfulCount: { type: Number, default: 0 },
    notHelpfulCount: { type: Number, default: 0 },

    adminResponse: { type: adminResponseSchema, default: null },
  },
  { timestamps: true }
);

// NOTE: unique index — enforces one review per user per product at the DB level, not just
// in app code; don't drop this thinking it's only a lookup-performance index
reviewSchema.index({ productId: 1, userId: 1 }, { unique: true });
reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ productId: 1, status: 1, helpfulCount: -1 });
reviewSchema.index({ userId: 1, createdAt: -1 });
reviewSchema.index({ status: 1, createdAt: -1 });

export const Review = mongoose.model("Review", reviewSchema);
