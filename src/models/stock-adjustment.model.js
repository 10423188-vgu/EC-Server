import mongoose from "mongoose";

const stockAdjustmentSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    productId: { type: String, required: true },
    variantId: { type: String, required: true },
    changedBy: { type: String, required: true },
    delta: { type: Number, required: true },
    before: { type: Number, required: true },
    after: { type: Number, required: true },
    reason: { type: String, required: true },
  },
  { timestamps: true },
);

stockAdjustmentSchema.index({ productId: 1, variantId: 1, createdAt: -1 });
export const StockAdjustment = mongoose.model(
  "StockAdjustment",
  stockAdjustmentSchema,
);
