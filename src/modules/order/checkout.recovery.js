import { prisma } from "../../configs/db/index.js";
import { Product } from "../../models/product.model.js";

export const CHECKOUT_TIMEOUT_MS = 15 * 60 * 1000;
const CHECKOUT_FAILURE_REASON = "Checkout did not complete";

export const releaseCouponUsage = async (tx, order) => {
  if (!order.couponId) return;
  const released = await tx.couponUsage.deleteMany({
    where: { orderId: order.id },
  });
  if (!released.count) return;
  await tx.coupon.updateMany({
    where: { id: order.couponId, usageCount: { gte: released.count } },
    data: { usageCount: { decrement: released.count } },
  });
};

export const recoverCheckout = async (orderId) => {
  const order = await prisma.$transaction(async (tx) => {
    const current = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        statusHistory: {
          where: {
            fromStatus: "PENDING",
            toStatus: "CANCELLED",
            reason: CHECKOUT_FAILURE_REASON,
          },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!current || !["PENDING", "CANCELLED"].includes(current.status)) {
      return null;
    }
    // why: a lost commit response may reach recovery after a customer cancelled
    // an already-published order. Its normal cancellation event owns restoration.
    if (current.status === "CANCELLED" && !current.statusHistory.length) {
      return null;
    }
    if (current.status === "PENDING") {
      const updated = await tx.order.updateMany({
        where: { id: orderId, status: "PENDING" },
        data: { status: "CANCELLED", statusChangedAt: new Date() },
      });
      if (!updated.count) return null;
      await tx.payment.updateMany({
        where: { orderId, status: "PENDING" },
        data: { status: "FAILED" },
      });
      await releaseCouponUsage(tx, current);
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: "PENDING",
          toStatus: "CANCELLED",
          reason: CHECKOUT_FAILURE_REASON,
        },
      });
    }
    return current;
  });
  if (!order?.items.length) return;

  // why: restore and fence late stock deductions in one Mongo update. A crashed
  // request may have deducted only some items, or still be running after expiry.
  await Product.bulkWrite(
    order.items.map(({ variantId, quantity }) => ({
      updateOne: {
        filter: { "variants._id": variantId },
        update: [
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
                            stock: {
                              $add: [
                                "$$variant.stock",
                                {
                                  $cond: [
                                    {
                                      $and: [
                                        {
                                          $in: [
                                            orderId,
                                            {
                                              $ifNull: [
                                                "$$variant.stockDeductionKeys",
                                                [],
                                              ],
                                            },
                                          ],
                                        },
                                        {
                                          $not: [
                                            {
                                              $in: [
                                                orderId,
                                                {
                                                  $ifNull: [
                                                    "$$variant.stockRestoreKeys",
                                                    [],
                                                  ],
                                                },
                                              ],
                                            },
                                          ],
                                        },
                                      ],
                                    },
                                    quantity,
                                    0,
                                  ],
                                },
                              ],
                            },
                            stockRestoreKeys: {
                              $setUnion: [
                                { $ifNull: ["$$variant.stockRestoreKeys", []] },
                                [orderId],
                              ],
                            },
                            stockDeductionKeys: {
                              $setDifference: [
                                {
                                  $ifNull: ["$$variant.stockDeductionKeys", []],
                                },
                                [orderId],
                              ],
                            },
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
        ],
      },
    })),
    { ordered: false },
  );
};
