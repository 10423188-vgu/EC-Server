import mongoose from "mongoose";
import { Product } from "../../models/product.model.js";
import { StockAdjustment } from "../../models/stock-adjustment.model.js";
import {
  BadRequestError,
  ConflictError,
} from "../../shared/errors/app.error.js";

export const adjustProductStock = async (
  productId,
  variantId,
  changedBy,
  data,
) => {
  const { requestId, delta, reason } = data;
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000000) {
    throw new BadRequestError("Invalid stock adjustment quantity");
  }
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const existing = await StockAdjustment.findById(requestId)
        .session(session)
        .lean();
      if (existing) {
        if (
          existing.productId !== productId ||
          existing.variantId !== variantId ||
          existing.changedBy !== changedBy ||
          existing.delta !== delta ||
          existing.reason !== reason
        ) {
          throw new ConflictError(
            "This adjustment request was already used with different values",
          );
        }
        return existing;
      }
      // why: stock and its audit record commit together; $add preserves concurrent
      // checkout deductions, and the predicate prevents negative inventory.
      const product = await Product.findOneAndUpdate(
        {
          _id: productId,
          deletedAt: null,
          variants: {
            $elemMatch: {
              _id: variantId,
              deletedAt: null,
              stock: {
                $gte: Math.max(0, -delta),
                $lte: Number.MAX_SAFE_INTEGER - Math.max(0, delta),
              },
            },
          },
        },
        [
          {
            $set: {
              variants: {
                $map: {
                  input: "$variants",
                  as: "variant",
                  in: {
                    $cond: [
                      { $eq: ["$$variant._id", variantId] },
                      {
                        $mergeObjects: [
                          "$$variant",
                          {
                            stock: { $add: ["$$variant.stock", delta] },
                            updatedAt: new Date(),
                          },
                        ],
                      },
                      "$$variant",
                    ],
                  },
                },
              },
            },
          },
          {
            $set: {
              inStock: {
                $anyElementTrue: {
                  $map: {
                    input: "$variants",
                    as: "variant",
                    in: {
                      $and: [
                        { $eq: ["$$variant.isActive", true] },
                        {
                          $eq: [
                            { $ifNull: ["$$variant.deletedAt", null] },
                            null,
                          ],
                        },
                        { $gt: ["$$variant.stock", 0] },
                      ],
                    },
                  },
                },
              },
            },
          },
        ],
        { session, returnDocument: "after", updatePipeline: true },
      ).lean();
      if (!product)
        throw new BadRequestError(
          "Variant is unavailable or the adjustment would make stock negative",
        );
      const after = product.variants.find(
        (variant) => variant._id === variantId,
      ).stock;
      const [adjustment] = await StockAdjustment.create(
        [
          {
            _id: requestId,
            productId,
            variantId,
            changedBy,
            delta,
            reason,
            before: after - delta,
            after,
          },
        ],
        { session },
      );
      return adjustment.toObject();
    });
  } finally {
    await session.endSession();
  }
};

export const listStockAdjustments = (productId, variantId) =>
  StockAdjustment.find({ productId, variantId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(50)
    .lean();
