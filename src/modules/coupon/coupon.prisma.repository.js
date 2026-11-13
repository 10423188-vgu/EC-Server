import { prisma } from "../../configs/db/index.js";
import { NotFoundError, BadRequestError } from "../../shared/errors/app.error.js";

export const couponPrismaRepository = {
  findByCode: (code) =>
    prisma.coupon.findUnique({ where: { code } }),

  findById: (id) =>
    prisma.coupon.findUnique({ where: { id } }),

  findAll: async ({ page, limit, isActive, type }) => {
    const where = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (type) where.type = type;

    const skip = (page - 1) * limit;
    const [coupons, total] = await Promise.all([
      prisma.coupon.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { usages: true } } },
      }),
      prisma.coupon.count({ where }),
    ]);

    return { coupons, total };
  },

  create: (data) => prisma.coupon.create({ data }),

  update: (id, data) =>
    prisma.coupon.update({ where: { id }, data }),

  delete: (id) => prisma.coupon.delete({ where: { id } }),

  countUserUsage: (couponId, userId) =>
    prisma.couponUsage.count({ where: { couponId, userId } }),

  // why: usageLimit/perUserLimit were previously checked by a plain SELECT in coupon.service.js
  // before this ran — two concurrent checkouts on the same (near-)exhausted coupon could both
  // pass that read and both insert usage, overrunning the limit. `FOR UPDATE` locks the Coupon
  // row so the second transaction blocks until the first commits, then re-reads a fresh count —
  // closing the race without a unique constraint (which would also wrongly cap perUserLimit > 1
  // coupons at exactly 1 use).
  applyUsage: async ({ couponId, userId, orderId, discount }, transaction) => {
    const apply = async (tx) => {
      const [coupon] = await tx.$queryRaw`
        SELECT "usageLimit", "usageCount", "perUserLimit"
        FROM "Coupon" WHERE id = ${couponId} FOR UPDATE
      `;
      if (!coupon) throw new NotFoundError("Coupon");
      if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
        throw new BadRequestError("Coupon usage limit has been reached");
      }
      const userUsed = await tx.couponUsage.count({ where: { couponId, userId } });
      if (userUsed >= coupon.perUserLimit) {
        throw new BadRequestError(
          coupon.perUserLimit === 1
            ? "You have already used this coupon"
            : `You can only use this coupon ${coupon.perUserLimit} times`
        );
      }

      await tx.coupon.update({ where: { id: couponId }, data: { usageCount: { increment: 1 } } });
      return tx.couponUsage.create({ data: { couponId, userId, orderId: orderId ?? null, discount } });
    };
    return transaction ? apply(transaction) : prisma.$transaction(apply);
  },
};
