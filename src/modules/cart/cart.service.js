import { cartRedisRepository } from "./cart.redis.repository.js";
import { Product } from "../../models/product.model.js";
import {
  NotFoundError,
  BadRequestError,
} from "../../shared/errors/app.error.js";

const resolveCartItems = async (cartHash) => {
  if (!cartHash || Object.keys(cartHash).length === 0) return [];

  const variantIds = Object.keys(cartHash);

  const products = await Product.find(
    { isActive: true, deletedAt: null, "variants._id": { $in: variantIds } },
    {
      name: 1,
      slug: 1,
      images: { $slice: 1 },
      categoryName: 1,
      brandName: 1,
      variants: 1,
    },
  ).lean();

  const variantMap = new Map();
  for (const product of products) {
    for (const v of product.variants) {
      variantMap.set(String(v._id), { product, variant: v });
    }
  }

  const items = [];
  for (const variantId of variantIds) {
    const entry = variantMap.get(variantId);
    // why: deleted/deactivated variants are dropped from the response here but not removed
    // from the Redis hash — they stay orphaned there until TTL expiry or an explicit write
    if (!entry) continue;

    const { product, variant } = entry;
    if (!variant.isActive || variant.deletedAt) continue;

    items.push({
      product: {
        id: String(product._id),
        name: product.name,
        slug: product.slug,
        image: variant.images?.[0] ?? product.images?.[0] ?? null,
      },
      variant: {
        id: String(variant._id),
        sku: variant.sku,
        name: variant.name,
        price: variant.price,
        salePrice: variant.salePrice,
        stock: variant.stock,
        options:
          variant.options instanceof Map
            ? Object.fromEntries(variant.options)
            : (variant.options ?? {}),
      },
      quantity: parseInt(cartHash[variantId], 10),
    });
  }

  return items;
};

export const cartService = {
  getCart: async (userId) => {
    const cartHash = await cartRedisRepository.getAll(userId);
    return resolveCartItems(cartHash);
  },

  addItem: async (userId, variantId) => {
    const product = await Product.findOne(
      { isActive: true, deletedAt: null, "variants._id": variantId },
      { "variants.$": 1 },
    ).lean();

    if (!product?.variants?.[0]) throw new NotFoundError("Variant");

    const variant = product.variants[0];
    if (!variant.isActive || variant.deletedAt)
      throw new BadRequestError("Variant is not available");

    // why: this Mongo stock read and the Redis write below aren't atomic with each other —
    // stock can change in between. That's fine: this is a cheap snapshot cap so the cart UI
    // can't run away past what stock looked like a moment ago; checkout's deductStock
    // (order.service.js) re-validates atomically against live stock before an order is placed.
    try {
      const newQty = await cartRedisRepository.incrementItemAtomic(
        userId,
        variantId,
        variant.stock,
      );
      return { updated: true, quantity: newQty };
    } catch (err) {
      if (err.message === "OVER_STOCK") {
        throw new BadRequestError(`Only ${variant.stock} item(s) in stock`);
      }
      throw err;
    }
  },

  upsertItem: async (userId, variantId, quantity) => {
    // why: quantity <= 0 means "remove this item" — check before querying Mongo, both
    // to skip a query whose result would go unused, and so a stale/deactivated variant
    // can still be removed from the cart instead of throwing before the removal runs
    if (quantity <= 0) {
      await cartRedisRepository.removeItem(userId, variantId);
      return { removed: true };
    }

    const product = await Product.findOne(
      { isActive: true, deletedAt: null, "variants._id": variantId },
      { "variants.$": 1 },
    ).lean();

    if (!product?.variants?.[0]) throw new NotFoundError("Variant");

    const variant = product.variants[0];
    if (!variant.isActive || variant.deletedAt)
      throw new BadRequestError("Variant is not available");

    // why: same non-atomic Mongo-read-then-Redis-write gap as addItem above — acceptable
    // because checkout re-validates stock atomically before an order is placed.
    try {
      const newQty = await cartRedisRepository.setItemAtomic(
        userId,
        variantId,
        variant.stock,
        quantity,
      );
      return { updated: true, quantity: newQty };
    } catch (err) {
      if (err.message === "OVER_STOCK") {
        throw new BadRequestError(`Only ${variant.stock} item(s) in stock`);
      }
      throw err;
    }
  },

  removeItem: async (userId, variantId) => {
    await cartRedisRepository.removeItem(userId, variantId);
  },

  clearCart: async (userId) => {
    await cartRedisRepository.clear(userId);
  },
};
