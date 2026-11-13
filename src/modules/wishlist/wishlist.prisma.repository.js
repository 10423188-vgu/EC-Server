import { prisma } from "../../configs/db/index.js";
import { Prisma } from "@prisma/client";

export const wishlistPrismaRepository = {
  findPage: (userId, { page, limit }) =>
    prisma.wishlist.findMany({
      where: { userId },
      select: { productId: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { productId: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),

  count: (userId) => prisma.wishlist.count({ where: { userId } }),

  deleteAll: (userId) => prisma.wishlist.deleteMany({ where: { userId } }),

  findIds: async (userId, productIds) => {
    const items = await prisma.wishlist.findMany({
      where: { userId, productId: { in: productIds } },
      select: { productId: true },
    });
    return items.map((i) => i.productId);
  },

  findOne: async (userId, productId) => {
    return prisma.wishlist.findUnique({
      where: { userId_productId: { userId, productId } },
    });
  },

  toggle: async (userId, productId, exists) => {
    if (exists) {
      try {
        await prisma.wishlist.delete({
          where: { userId_productId: { userId, productId } },
        });
      } catch (err) {
        // why: P2025 (record not found) means a concurrent request already deleted it — same
        // end state as this request succeeding, so treat it as success rather than erroring
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")) {
          throw err;
        }
      }
      return { added: false };
    }

    try {
      await prisma.wishlist.create({ data: { userId, productId } });
      return { added: true };
    } catch (err) {
      // why: P2002 (unique constraint) means a concurrent request already created it — same
      // end state as this request succeeding, so treat it as success rather than erroring
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return { added: true };
      }
      throw err;
    }
  },
};
