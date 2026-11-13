import { couponPrismaRepository } from "./coupon.prisma.repository.js";
import { cartRedisRepository } from "../cart/cart.redis.repository.js";
import { Product } from "../../models/product.model.js";
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
} from "../../shared/errors/app.error.js";

// ─── Cart resolution ───────────────────────────────────────────────────────────
const resolveCartForCoupon = async (userId) => {
  const cartHash = await cartRedisRepository.getAll(userId);
  if (!cartHash || !Object.keys(cartHash).length) return [];

  const variantIds = Object.keys(cartHash);
  const products = await Product.find(
    { isActive: true, deletedAt: null, "variants._id": { $in: variantIds } },
    { name: 1, categoryId: 1, brandId: 1, variants: 1 }
  ).lean();

  const variantMap = new Map();
  for (const p of products) {
    for (const v of p.variants) {
      variantMap.set(String(v._id), { product: p, variant: v });
    }
  }

  const items = [];
  for (const variantId of variantIds) {
    const entry = variantMap.get(variantId);
    if (!entry || !entry.variant.isActive || entry.variant.deletedAt) continue;
    const { product, variant } = entry;
    items.push({
      variantId,
      productId: String(product._id),
      categoryId: product.categoryId,
      brandId: product.brandId ?? null,
      price: variant.salePrice ?? variant.price,
      quantity: parseInt(cartHash[variantId], 10),
    });
  }
  return items;
};

// ─── Scope filtering ───────────────────────────────────────────────────────────
const filterByScope = (items, coupon) => {
  if (coupon.scope === "ALL") return items;

  const ids = new Set(coupon.scopeIds);
  if (coupon.scope === "CATEGORY")
    return items.filter((i) => i.categoryId && ids.has(i.categoryId));
  if (coupon.scope === "PRODUCT")
    return items.filter((i) => ids.has(i.productId));
  if (coupon.scope === "BRAND")
    return items.filter((i) => i.brandId && ids.has(i.brandId));

  return [];
};

// ─── Discount calculation ──────────────────────────────────────────────────────
const calcDiscount = (coupon, eligibleTotal, cartTotal) => {
  // why: free shipping is waived as the order's shippingFee at checkout, not returned as a cart discount here
  if (coupon.type === "FREE_SHIPPING") return 0;

  let amount = 0;
  if (coupon.type === "PERCENTAGE") {
    amount = (eligibleTotal * Number(coupon.value)) / 100;
    if (coupon.maxDiscount) amount = Math.min(amount, Number(coupon.maxDiscount));
  } else {
    amount = Math.min(Number(coupon.value), eligibleTotal);
  }

  return Math.round(amount * 100) / 100;
};

// ─── Guards ────────────────────────────────────────────────────────────────────
const assertCouponUsable = async (coupon, userId) => {
  if (!coupon || !coupon.isActive) throw new NotFoundError("Coupon");

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) throw new BadRequestError("Coupon is not yet valid");
  if (coupon.expiresAt && coupon.expiresAt < now) throw new BadRequestError("Coupon has expired");
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
    throw new BadRequestError("Coupon usage limit has been reached");
  }

  const userUsed = await couponPrismaRepository.countUserUsage(coupon.id, userId);
  if (userUsed >= coupon.perUserLimit) {
    throw new BadRequestError(
      coupon.perUserLimit === 1
        ? "You have already used this coupon"
        : `You can only use this coupon ${coupon.perUserLimit} times`
    );
  }
};

// ─── Service ───────────────────────────────────────────────────────────────────
export const couponService = {
  // why: checkout already resolves the cart once — pass it via cartItems to skip the redundant Redis+Mongo re-fetch
  validate: async ({ userId, code, cartItems: preResolvedCartItems }) => {
    // why: cart resolution (Redis + Mongo) doesn't depend on the coupon lookup — run them
    // together instead of paying for both round trips back-to-back
    const [coupon, cartItems] = await Promise.all([
      couponPrismaRepository.findByCode(code.toUpperCase()),
      preResolvedCartItems ?? resolveCartForCoupon(userId),
    ]);
    await assertCouponUsable(coupon, userId);

    if (!cartItems.length) throw new BadRequestError("Your cart is empty");

    const eligibleItems = filterByScope(cartItems, coupon);
    if (!eligibleItems.length) {
      throw new BadRequestError("This coupon is not applicable to any item in your cart");
    }

    const cartTotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const eligibleTotal = eligibleItems.reduce((s, i) => s + i.price * i.quantity, 0);

    if (coupon.minOrderAmount && cartTotal < Number(coupon.minOrderAmount)) {
      throw new BadRequestError(
        `Minimum order amount for this coupon is ${Number(coupon.minOrderAmount).toFixed(2)}`
      );
    }

    const discountAmount = calcDiscount(coupon, eligibleTotal, cartTotal);

    return {
      coupon: {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        type: coupon.type,
        value: Number(coupon.value),
        scope: coupon.scope,
        isFreeShipping: coupon.type === "FREE_SHIPPING",
      },
      cartTotal: Math.round(cartTotal * 100) / 100,
      eligibleTotal: Math.round(eligibleTotal * 100) / 100,
      discountAmount,
      finalTotal: Math.max(0, Math.round((cartTotal - discountAmount) * 100) / 100),
    };
  },

  // why: thin wrapper — the atomicity/locking guarantee against concurrent overuse lives in couponPrismaRepository.applyUsage
  apply: async ({ userId, couponId, orderId, discountAmount }, tx) => {
    await couponPrismaRepository.applyUsage(
      { couponId, userId, orderId, discount: discountAmount },
      tx,
    );
  },

  // ─── Admin CRUD ──────────────────────────────────────────────────────────────
  create: async (data) => {
    const existing = await couponPrismaRepository.findByCode(data.code);
    if (existing) throw new ConflictError(`Coupon code "${data.code}" already exists`);
    return couponPrismaRepository.create(data);
  },

  update: async (id, data) => {
    const coupon = await couponPrismaRepository.findById(id);
    if (!coupon) throw new NotFoundError("Coupon");
    return couponPrismaRepository.update(id, data);
  },

  delete: async (id) => {
    const coupon = await couponPrismaRepository.findById(id);
    if (!coupon) throw new NotFoundError("Coupon");
    if (coupon.usageCount > 0) {
      throw new ConflictError("Used coupons cannot be deleted. Deactivate the coupon instead.");
    }
    return couponPrismaRepository.delete(id);
  },

  getById: async (id) => {
    const coupon = await couponPrismaRepository.findById(id);
    if (!coupon) throw new NotFoundError("Coupon");
    return coupon;
  },

  list: async ({ page, limit, isActive, type }) => {
    const { coupons, total } = await couponPrismaRepository.findAll({ page, limit, isActive, type });
    return {
      data: coupons,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },
};
