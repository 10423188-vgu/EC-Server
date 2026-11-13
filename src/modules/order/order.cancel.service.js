import { prisma } from "../../configs/db/index.js";
import { outboxRepository } from "../../shared/outbox/outbox.prisma.repository.js";
import { releaseCouponUsage } from "./checkout.recovery.js";
import { ForbiddenError } from "../../shared/errors/app.error.js";

export const cancelResolvedOrder = async ({
  order,
  changedByUserId,
  reason,
}) => {
  const orderUpdate = await prisma.$transaction(async (tx) => {
    const currentOrder = await tx.order.findUnique({
      where: { id: order.id },
      select: { status: true, userId: true, couponId: true },
    });
    if (!currentOrder || currentOrder.status !== "AWAITING_PAYMENT") {
      return { count: 0 };
    }

    const updated = await tx.order.updateMany({
      where: { id: order.id, status: currentOrder.status },
      data: { status: "CANCELLED", statusChangedAt: new Date() },
    });
    if (!updated.count) return updated;

    const paymentUpdate = await tx.payment.updateMany({
      where: { orderId: order.id, status: "PENDING" },
      data: { status: "FAILED" },
    });
    if (!paymentUpdate.count) {
      throw new ForbiddenError("Only unpaid orders can be cancelled");
    }

    await releaseCouponUsage(tx, { ...order, couponId: currentOrder.couponId });
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: currentOrder.status,
        toStatus: "CANCELLED",
        changedByUserId,
        reason: reason ?? null,
      },
    });
    await outboxRepository.enqueue(tx, {
      eventType: "order.status.changed",
      payload: {
        orderId: order.id,
        userId: currentOrder.userId,
        status: "CANCELLED",
      },
    });
    await outboxRepository.enqueue(tx, {
      eventType: "order.stock.restore",
      payload: {
        orderId: order.id,
        items: order.items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
      },
    });
    return updated;
  });

  if (!orderUpdate.count) {
    throw new ForbiddenError("Only unpaid orders can be cancelled");
  }

  return { orderId: order.id };
};
