import { Product } from "../../models/product.model.js";
import { prisma } from "../../configs/db/index.js";
import { notificationPrismaRepository } from "../../modules/notification/notification.prisma.repository.js";
import { notificationService } from "../../modules/notification/notification.service.js";
import { recoverCheckout } from "../../modules/order/checkout.recovery.js";
import { cartRedisRepository } from "../../modules/cart/cart.redis.repository.js";
import { wishlistService } from "../../modules/wishlist/wishlist.service.js";

// why: the polling worker (src/workers/outbox.worker.js) is generic — it knows nothing about
// individual event types. Wiring a new source-of-truth change to sync later means adding one
// entry here, not touching the poll/retry engine.
export const outboxHandlers = {
  "wishlist.price.dropped": (payload, { eventId }) =>
    wishlistService.sendPriceDropAlerts(payload, eventId),
  "order.checkout.recover": ({ orderId }) => recoverCheckout(orderId),

  "order.cart.clear": ({ orderId, userId, items, expiresAt }) => {
    // why: after the cart's own lifetime, an old cleanup must not touch a new cart.
    if (expiresAt && Date.now() >= new Date(expiresAt).getTime()) return;
    return cartRedisRepository.clearPurchased(userId, orderId, items);
  },

  "order.created": async ({ orderId, userId, variantIds }, { eventId }) => {
    await notificationPrismaRepository
      .create({
        userId,
        orderId,
        eventKey: eventId,
        ...notificationService.buildOrderCreated({ orderId }),
      })
      .catch((err) => {
        if (err?.code !== "P2002") throw err;
      });
    if (variantIds?.length) {
      // why: successful orders no longer need crash-recovery markers. Retaining
      // one marker per sale would grow each variant document without a bound.
      await Product.updateMany(
        { "variants._id": { $in: variantIds } },
        { $pull: { "variants.$[].stockDeductionKeys": orderId } },
      );
    }
  },

  "order.status.changed": async ({ orderId, userId, status }, { eventId }) => {
    await notificationPrismaRepository
      .create({
        userId,
        orderId,
        eventKey: eventId,
        ...notificationService.buildOrderStatusChanged({ orderId, status }),
      })
      .catch((err) => {
        if (err?.code !== "P2002") throw err;
      });
  },

  "order.refund.completed": async (
    { orderId, userId, amount, isFullRefund },
    { eventId },
  ) => {
    await notificationPrismaRepository
      .create({
        userId,
        orderId,
        eventKey: eventId,
        ...notificationService.buildOrderRefunded({
          orderId,
          amount,
          isFullRefund,
        }),
      })
      .catch((err) => {
        if (err?.code !== "P2002") throw err;
      });
  },

  "return.status.changed": async ({ orderId, userId, status }, { eventId }) => {
    await notificationPrismaRepository
      .create({
        userId,
        orderId,
        eventKey: eventId,
        ...notificationService.buildReturnStatusChanged({ orderId, status }),
      })
      .catch((err) => {
        if (err?.code !== "P2002") throw err;
      });
  },

  "order.stock.restore": async ({ items, returnRequestId }, { eventId }) => {
    await Product.bulkWrite(
      items.map(({ variantId, quantity }) => ({
        updateOne: {
          filter: {
            variants: {
              $elemMatch: {
                _id: variantId,
                stockRestoreKeys: { $ne: eventId },
              },
            },
          },
          update: {
            $inc: { "variants.$.stock": quantity },
            $addToSet: { "variants.$.stockRestoreKeys": eventId },
          },
        },
      })),
      { ordered: false },
    );
    if (returnRequestId) {
      await prisma.returnRequest.update({
        where: { id: returnRequestId },
        data: { restockedAt: new Date() },
      });
    }
  },

  "brand.renamed": async ({ brandId, name, slug }) => {
    await Product.updateMany(
      { brandId },
      {
        $set: {
          ...(name !== undefined && { brandName: name }),
          ...(slug !== undefined && { brandSlug: slug }),
        },
      },
    );
  },

  "category.renamed": async ({ categoryId, name, slug }) => {
    await Product.updateMany(
      { categoryId },
      {
        $set: {
          ...(name !== undefined && { categoryName: name }),
          ...(slug !== undefined && { categorySlug: slug }),
        },
      },
    );
  },
};
