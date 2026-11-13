import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

const productChangeSchema = new mongoose.Schema({
  _id: { type: String, default: randomUUID },
  productId: { type: String, required: true },
  changedBy: { type: String, required: true },
  action: { type: String, required: true },
  priceDrop: {
    type: new mongoose.Schema(
      {
        name: String,
        previousPrice: Number,
        price: Number,
      },
      { _id: false },
    ),
    default: undefined,
  },
  priceAlertRelayedAt: { type: Date, default: null },
  variants: [{ _id: false, id: String, name: String, sku: String }],
  changes: [
    {
      _id: false,
      field: { type: String, required: true },
      before: mongoose.Schema.Types.Mixed,
      after: mongoose.Schema.Types.Mixed,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});
productChangeSchema.index({ productId: 1, createdAt: -1, _id: -1 });
productChangeSchema.index(
  { priceAlertRelayedAt: 1, createdAt: 1 },
  { partialFilterExpression: { priceDrop: { $exists: true } } },
);

export const ProductChange = mongoose.model(
  "ProductChange",
  productChangeSchema,
);
