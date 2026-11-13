import { prisma } from "../../configs/db/index.js";
import { outboxRepository } from "../../shared/outbox/outbox.prisma.repository.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../shared/errors/app.error.js";
import { getReturnEligibility, RETURN_WINDOW_DAYS } from "./return.policy.js";
import { calculateReturnRefund } from "./return.refund.js";

const ACTIVE_RETURN_STATUSES = ["REQUESTED", "INSPECTING", "APPROVED"];
const ACCEPTED_RETURN_STATUSES = ["APPROVED", "REFUNDED", "NO_REFUND"];

const RETURN_TRANSITIONS = {
  REQUESTED: ["INSPECTING"],
  INSPECTING: ["APPROVED", "REJECTED"],
};

const validateRequestedItems = (orderItems, requestedItems) => {
  const orderItemMap = new Map(orderItems.map((item) => [item.id, item]));
  const uniqueIds = new Set(requestedItems.map((item) => item.orderItemId));
  if (uniqueIds.size !== requestedItems.length) {
    throw new BadRequestError("Each order item may only appear once");
  }
  for (const item of requestedItems) {
    const orderItem = orderItemMap.get(item.orderItemId);
    if (!orderItem || item.quantity > orderItem.quantity) {
      throw new BadRequestError("Invalid return item or quantity");
    }
  }
  return orderItemMap;
};

export const returnService = {
  create: async (orderId, userId, data) => {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findFirst({
        where: { id: orderId, userId },
        include: {
          items: true,
          returnRequests: {
            where: {
              status: {
                in: [...ACTIVE_RETURN_STATUSES, "REFUNDED", "NO_REFUND"],
              },
            },
            include: { items: true },
          },
        },
      });
      if (!order) throw new NotFoundError("Order");
      if (order.status !== "DELIVERED") {
        throw new BadRequestError(
          "Returns can only be requested for delivered orders",
        );
      }
      if (!getReturnEligibility(order).canRequestReturn) {
        throw new BadRequestError(
          `Returns must be requested within ${RETURN_WINDOW_DAYS} days of delivery`,
        );
      }
      const orderItemMap = validateRequestedItems(order.items, data.items);
      if (
        order.returnRequests.some((request) =>
          ACTIVE_RETURN_STATUSES.includes(request.status),
        )
      ) {
        throw new ConflictError(
          "Resolve the current return before requesting another",
        );
      }
      const accepted = new Map();
      for (const request of order.returnRequests) {
        if (!ACCEPTED_RETURN_STATUSES.includes(request.status)) continue;
        for (const item of request.items) {
          accepted.set(
            item.orderItemId,
            (accepted.get(item.orderItemId) ?? 0) + item.quantity,
          );
        }
      }
      for (const item of data.items) {
        const ordered = orderItemMap.get(item.orderItemId);
        if (
          (accepted.get(item.orderItemId) ?? 0) + item.quantity >
          ordered.quantity
        ) {
          throw new BadRequestError(
            "Return quantity exceeds the remaining quantity",
          );
        }
      }

      return tx.returnRequest.create({
        data: {
          orderId,
          userId,
          reason: data.reason,
          evidenceImages: data.evidenceImages,
          customerNote: data.customerNote ?? null,
          items: { createMany: { data: data.items } },
        },
        include: { items: true },
      });
    });
  },

  adminUpdateStatus: async (returnId, adminId, data) => {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ReturnRequest" WHERE id = ${returnId} FOR UPDATE`;
      const request = await tx.returnRequest.findUnique({
        where: { id: returnId },
        include: {
          order: { include: { items: true, payment: true } },
          items: { include: { orderItem: true } },
        },
      });
      if (!request) throw new NotFoundError("Return request");
      if (!RETURN_TRANSITIONS[request.status]?.includes(data.status)) {
        throw new BadRequestError(
          `Cannot change a return from ${request.status} to ${data.status}`,
        );
      }

      if (data.status === "INSPECTING") {
        await tx.returnRequest.update({
          where: { id: returnId },
          data: { status: data.status, inspectedBy: adminId },
        });
        return;
      }

      const resolvedAt = new Date();
      if (data.status === "REJECTED") {
        await tx.returnRequest.update({
          where: { id: returnId },
          data: {
            status: data.status,
            inspectionResult: data.inspectionResult,
            inspectedBy: adminId,
            inspectedAt: resolvedAt,
            resolvedAt,
          },
        });
        await outboxRepository.enqueue(tx, {
          eventType: "return.status.changed",
          payload: {
            orderId: request.orderId,
            userId: request.userId,
            status: data.status,
          },
        });
        return;
      }

      const payment = request.order.payment;
      if (
        !payment ||
        !["COMPLETED", "PARTIALLY_REFUNDED"].includes(payment.status)
      ) {
        throw new BadRequestError("This order has no refundable payment");
      }
      const previousReturns = await tx.returnRequest.findMany({
        where: {
          orderId: request.orderId,
          id: { not: returnId },
          status: { in: ACCEPTED_RETURN_STATUSES },
        },
        include: { items: true },
      });
      const remainingAmount =
        Number(payment.amount) - Number(payment.refundedAmount);
      const refundAmount = calculateReturnRefund(
        request.order,
        request.items,
        previousReturns,
      );
      if (refundAmount > remainingAmount) {
        throw new BadRequestError(
          `Refund amount cannot exceed ${remainingAmount}`,
        );
      }

      const requestedItemIds = new Set(
        request.items.map((item) => item.orderItemId),
      );
      if (data.restockItemIds.some((id) => !requestedItemIds.has(id))) {
        throw new BadRequestError("Only requested items can be restocked");
      }
      if (data.restockItemIds.length) {
        await tx.returnRequestItem.updateMany({
          where: {
            returnRequestId: returnId,
            orderItemId: { in: data.restockItemIds },
          },
          data: { restockable: true },
        });
        const restockIds = new Set(data.restockItemIds);
        await outboxRepository.enqueue(tx, {
          eventType: "order.stock.restore",
          payload: {
            orderId: request.orderId,
            returnRequestId: returnId,
            items: request.items
              .filter((item) => restockIds.has(item.orderItemId))
              .map((item) => ({
                variantId: item.orderItem.variantId,
                quantity: item.quantity,
              })),
          },
        });
      }

      await tx.returnRequest.update({
        where: { id: returnId },
        data: {
          status: refundAmount === 0 ? "NO_REFUND" : data.status,
          inspectionResult: data.inspectionResult,
          inspectedBy: adminId,
          inspectedAt: resolvedAt,
          refundAmount,
          resolvedAt,
        },
      });
      await outboxRepository.enqueue(tx, {
        eventType: "return.status.changed",
        payload: {
          orderId: request.orderId,
          userId: request.userId,
          status: data.status,
        },
      });
    });

    return prisma.returnRequest.findUnique({
      where: { id: returnId },
      include: {
        inspector: { select: { id: true, name: true, role: true } },
        items: { include: { orderItem: true } },
      },
    });
  },
};
