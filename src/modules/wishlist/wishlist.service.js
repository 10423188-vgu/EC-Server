import { wishlistPrismaRepository } from "./wishlist.prisma.repository.js";
import { Product } from "../../models/product.model.js";
import { NotFoundError } from "../../shared/errors/app.error.js";
import { prisma } from "../../configs/db/index.js";
import { randomBytes } from "node:crypto";
import { lowestProductPrice } from "../product/product.pricing.js";

const PREFERENCES_SELECT = {
  wishlistShareToken: true,
  wishlistSaleAlerts: true,
};
const toPreferences = (user) => ({
  shareToken: user.wishlistShareToken,
  saleAlerts: user.wishlistSaleAlerts,
});

export const wishlistService = {
  getPreferences: async (userId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: PREFERENCES_SELECT,
    });
    if (!user) throw new NotFoundError("User");
    return toPreferences(user);
  },

  updatePreferences: async (userId, saleAlerts) => {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { wishlistSaleAlerts: saleAlerts },
      select: PREFERENCES_SELECT,
    });
    return toPreferences(user);
  },

  enableSharing: async (userId) => {
    await prisma.user.updateMany({
      where: { id: userId, wishlistShareToken: null, suspendedAt: null },
      data: { wishlistShareToken: randomBytes(32).toString("base64url") },
    });
    return wishlistService.getPreferences(userId);
  },

  disableSharing: async (userId) => {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { wishlistShareToken: null },
      select: PREFERENCES_SELECT,
    });
    return toPreferences(user);
  },

  getSharedWishlist: async (token, { page, limit }) => {
    const user = await prisma.user.findUnique({
      where: { wishlistShareToken: token },
      select: { id: true, suspendedAt: true },
    });
    if (!user || user.suspendedAt) throw new NotFoundError("Shared wishlist");
    const where = { userId: user.id };
    const [items, total] = await Promise.all([
      prisma.wishlist.findMany({
        where,
        select: { productId: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { productId: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.wishlist.count({ where }),
    ]);
    const products = await wishlistService.getWishlist(items);
    // why: the bearer link exposes products only; never account/contact data.
    return {
      data: products.map(({ product }) => ({ product })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  getPaginatedWishlist: async (userId, { page, limit }) => {
    const [items, total] = await Promise.all([
      wishlistPrismaRepository.findPage(userId, { page, limit }),
      wishlistPrismaRepository.count(userId),
    ]);
    return {
      data: await wishlistService.getWishlist(items),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  clearWishlist: async (userId) => {
    const result = await wishlistPrismaRepository.deleteAll(userId);
    return { deletedCount: result.count };
  },

  sendPriceDropAlerts: async (
    { productId, name, price, observedAt },
    eventId,
  ) => {
    const product = await Product.findOne(
      { _id: productId, isActive: true, deletedAt: null },
      {
        "variants.price": 1,
        "variants.salePrice": 1,
        "variants.isActive": 1,
        "variants.deletedAt": 1,
      },
    ).lean();
    const currentPrice = lowestProductPrice(product);
    if (currentPrice == null || currentPrice > price) return;
    let cursor;
    do {
      const recipients = await prisma.wishlist.findMany({
        where: {
          productId,
          ...(cursor && { userId: { gt: cursor } }),
          createdAt: { lte: new Date(observedAt) },
          user: { wishlistSaleAlerts: true, suspendedAt: null },
        },
        select: { userId: true },
        orderBy: { userId: "asc" },
        take: 100,
      });
      if (!recipients.length) break;
      await prisma.notification.createMany({
        data: recipients.map(({ userId }) => ({
          userId,
          eventKey: `${eventId}:${userId}`,
          type: "WISHLIST_PRICE_DROP",
          title: "Wishlist price drop",
          message: `${name} is now ${Number(price).toLocaleString("vi-VN")} VND.`,
          link: `/products/${productId}`,
        })),
        skipDuplicates: true,
      });
      cursor = recipients.length === 100 ? recipients.at(-1).userId : null;
    } while (cursor);
  },

  // why: wishlist rows (Postgres) only hold productId — details are denormalized in MongoDB,
  // so a lookup here always spans both stores
  getWishlist: async (items) => {
    if (!items.length) return [];

    const productIds = items.map((i) => i.productId);
    const products = await Product.find(
      { _id: { $in: productIds }, isActive: true, deletedAt: null },
      {
        name: 1,
        slug: 1,
        images: { $slice: 1 },
        "variants.price": 1,
        "variants.salePrice": 1,
        "variants.isActive": 1,
        "variants.deletedAt": 1,
        "variants.stock": 1,
      },
    ).lean();

    const productMap = new Map(products.map((p) => [String(p._id), p]));

    return items
      .map((item) => {
        const p = productMap.get(item.productId);
        if (!p) return null;

        const cheapestVariant = (p.variants ?? [])
          .filter((v) => v.isActive && !v.deletedAt)
          .sort(
            (a, b) => (a.salePrice ?? a.price) - (b.salePrice ?? b.price),
          )[0];

        return {
          createdAt: item.createdAt,
          product: {
            id: String(p._id),
            name: p.name,
            slug: p.slug,
            image: p.images?.[0] ?? null,
            price: cheapestVariant?.price ?? null,
            salePrice: cheapestVariant?.salePrice ?? null,
            stock: cheapestVariant?.stock ?? 0,
          },
        };
      })
      .filter(Boolean);
  },

  getWishlistIds: async (userId, productIds) => {
    const ids = await wishlistPrismaRepository.findIds(userId, productIds);
    if (!ids.length) return [];

    // why: Postgres wishlist rows aren't cleaned up if the Mongo product is deleted separately,
    // so stale ids need filtering out here before returning
    const existing = await Product.find(
      { _id: { $in: ids }, isActive: true, deletedAt: null },
      { _id: 1 },
    ).lean();
    const validSet = new Set(existing.map((p) => String(p._id)));
    return ids.filter((id) => validSet.has(id));
  },

  toggleWishlist: async (userId, productId) => {
    const existing = await wishlistPrismaRepository.findOne(userId, productId);

    if (!existing) {
      const productExists = await Product.exists({
        _id: productId,
        isActive: true,
        deletedAt: null,
      });
      if (!productExists) throw new NotFoundError("Product");
    }

    return wishlistPrismaRepository.toggle(userId, productId, !!existing);
  },
};
