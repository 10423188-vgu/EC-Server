import { prisma } from "../../configs/db/index.js";
import { outboxRepository } from "../../shared/outbox/outbox.prisma.repository.js";
import { orderPrismaRepository } from "./order.prisma.repository.js";
import { orderAnalyticsRepository } from "./order.analytics.repository.js";
import { orderAdminExportService } from "./order.admin-export.service.js";
import { cancelResolvedOrder } from "./order.cancel.service.js";
import { MAX_ADMIN_ORDER_OFFSET } from "./order.policy.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../shared/errors/app.error.js";

const ADMIN_STATUS_TRANSITIONS = {
  PAID: ["PROCESSING"],
  PROCESSING: ["PAID", "SHIPPED"],
  SHIPPED: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
};
const ADMIN_ACTIONS_BY_STATUS = {
  PENDING: [],
  AWAITING_PAYMENT: ["CONFIRM_PAYMENT", "CANCEL"],
  PAID: ["PROCESS"],
  PROCESSING: ["UNDO", "SHIP"],
  SHIPPED: ["DISPATCH"],
  OUT_FOR_DELIVERY: ["DELIVER"],
  DELIVERED: ["REFUND"],
};

const withAdminActions = (order) => {
  if (!order) return order;
  const refundableAmount = order.payment
    ? Math.max(
        0,
        Number(order.payment.amount) -
          Number(order.payment.refundedAmount ?? 0),
      )
    : 0;
  const approvedReturn = order.returnRequests?.find(
    (returnRequest) => returnRequest.status === "APPROVED",
  );

  return {
    ...order,
    adminActions: (ADMIN_ACTIONS_BY_STATUS[order.status] ?? []).filter(
      (action) =>
        action !== "REFUND" || (refundableAmount > 0 && approvedReturn),
    ),
    refundableAmount,
    approvedReturnId: approvedReturn?.id ?? null,
  };
};

// ─── Cart resolution for checkout ─────────────────────────────────────────────

export const orderAdminService = {
  adminListOrders: async (filters) => {
    const { page, limit } = filters;
    const [orders, total] = await orderPrismaRepository.findAll(filters);
    return {
      data: orders.map(withAdminActions),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.min(
          Math.ceil(total / limit),
          Math.floor(MAX_ADMIN_ORDER_OFFSET / limit) + 1,
        ),
        isLimited: total > MAX_ADMIN_ORDER_OFFSET + limit,
      },
    };
  },

  adminGetMetrics: (filters) => orderPrismaRepository.getAdminMetrics(filters),

  adminGetAnalytics: ({ days }) => orderAnalyticsRepository.getOverview(days),

  adminGetSelected: async (ids) => {
    const orders = await orderPrismaRepository.findSelected([...new Set(ids)]);
    return orders.map(withAdminActions);
  },

  adminValidateSelected: async (ids) => {
    if ((await orderPrismaRepository.countSelected(ids)) !== ids.length)
      throw new ConflictError(
        "Some selected orders are unavailable. Refresh the list.",
      );
  },

  adminExportSelectedCsv: orderAdminExportService.adminExportSelectedCsv,
  adminExportCsv: orderAdminExportService.adminExportCsv,

  adminUpdateShipping: async (orderId, data) => {
    const order = await orderPrismaRepository.findById(orderId);
    if (!order) throw new NotFoundError("Order");
    await orderPrismaRepository.updateShipping(orderId, data);
    return withAdminActions(await orderPrismaRepository.findAdminById(orderId));
  },

  adminGetOrderById: async (orderId) => {
    const order = await orderPrismaRepository.findAdminById(orderId);
    if (!order) throw new NotFoundError("Order");
    return withAdminActions(order);
  },

  adminCancelOrder: async (orderId, adminId, reason) => {
    const order = await orderPrismaRepository.findById(orderId);
    if (!order) throw new NotFoundError("Order");
    if (order.status !== "AWAITING_PAYMENT") {
      throw new BadRequestError("Only unpaid orders can be cancelled");
    }
    return cancelResolvedOrder({
      order,
      changedByUserId: adminId,
      reason: reason.trim(),
    });
  },

  adminRefundOrder: async (
    orderId,
    { amount, reason, transactionId, returnRequestId },
    adminId,
  ) => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE "orderId" = ${orderId} FOR UPDATE`;
        const existingRefund = await tx.refund.findUnique({
          where: { transactionId },
        });
        if (existingRefund) {
          if (
            existingRefund.orderId === orderId &&
            Number(existingRefund.amount) === amount &&
            (!returnRequestId ||
              existingRefund.returnRequestId === returnRequestId)
          ) {
            return;
          }
          throw new ConflictError("Refund transaction ID already exists");
        }
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            payment: true,
            items: { select: { id: true } },
            returnRequests: {
              where: { status: "APPROVED" },
              take: 1,
            },
          },
        });
        if (!order) throw new NotFoundError("Order");
        if (order.status !== "DELIVERED") {
          throw new BadRequestError("Only delivered orders can be refunded");
        }
        if (
          !order.payment ||
          !["COMPLETED", "PARTIALLY_REFUNDED"].includes(order.payment.status)
        ) {
          throw new BadRequestError("This order has no refundable payment");
        }
        const approvedReturn = order.returnRequests[0];
        if (returnRequestId && approvedReturn?.id !== returnRequestId) {
          throw new BadRequestError("This return is not awaiting a refund");
        }
        if (order.items.length && !approvedReturn) {
          throw new BadRequestError(
            "A physical order can only be refunded after its return is approved",
          );
        }
        if (approvedReturn && Number(approvedReturn.refundAmount) <= 0) {
          throw new BadRequestError(
            "This return does not require a bank refund",
          );
        }

        const refundedAmount = Number(order.payment.refundedAmount);
        const remainingAmount = Number(order.payment.amount) - refundedAmount;
        if (amount > remainingAmount) {
          throw new BadRequestError(
            `Refund amount cannot exceed ${remainingAmount}`,
          );
        }
        if (
          approvedReturn?.refundAmount !== null &&
          approvedReturn?.refundAmount !== undefined &&
          amount !== Number(approvedReturn.refundAmount)
        ) {
          throw new BadRequestError(
            `Refund amount must match the approved amount ${Number(approvedReturn.refundAmount)}`,
          );
        }
        const nextRefundedAmount = refundedAmount + amount;
        const isFullRefund = nextRefundedAmount >= Number(order.payment.amount);

        await tx.refund.create({
          data: {
            orderId,
            amount,
            reason,
            transactionId,
            status: "COMPLETED",
            approvedBy: adminId,
            returnRequestId: approvedReturn?.id ?? null,
          },
        });
        await tx.payment.update({
          where: { orderId },
          data: {
            refundedAmount: nextRefundedAmount,
            status: isFullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED",
          },
        });
        if (approvedReturn) {
          await tx.returnRequest.update({
            where: { id: approvedReturn.id },
            data: { status: "REFUNDED", refundedAt: new Date() },
          });
        }

        if (isFullRefund) {
          await tx.order.update({
            where: { id: orderId },
            data: { status: "REFUNDED", statusChangedAt: new Date() },
          });
          await tx.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: "DELIVERED",
              toStatus: "REFUNDED",
              changedByUserId: adminId,
              reason,
            },
          });
        }

        await outboxRepository.enqueue(tx, {
          eventType: "order.refund.completed",
          payload: {
            orderId,
            userId: order.userId,
            amount,
            isFullRefund,
          },
        });
      });
    } catch (error) {
      if (error?.code === "P2002") {
        const existingRefund = await prisma.refund.findUnique({
          where: { transactionId },
        });
        if (
          existingRefund?.orderId === orderId &&
          Number(existingRefund.amount) === amount &&
          (!returnRequestId ||
            existingRefund.returnRequestId === returnRequestId)
        ) {
          return withAdminActions(
            await orderPrismaRepository.findAdminById(orderId),
          );
        }
        throw new ConflictError("Refund transaction ID already exists");
      }
      throw error;
    }

    return withAdminActions(await orderPrismaRepository.findAdminById(orderId));
  },

  adminUpdateStatus: async (orderId, status, changedByUserId, reason) => {
    const order = await orderPrismaRepository.findById(orderId);
    if (!order) throw new NotFoundError("Order");
    if (order.status === status) return withAdminActions(order);
    if (!ADMIN_STATUS_TRANSITIONS[order.status]?.includes(status)) {
      throw new BadRequestError(
        `Cannot change an order from ${order.status} to ${status}`,
      );
    }
    const normalizedReason = reason?.trim();
    if (
      order.status === "PROCESSING" &&
      status === "PAID" &&
      !normalizedReason
    ) {
      throw new BadRequestError(
        "A reason is required when returning an order to paid",
      );
    }

    // why: the source-of-truth update and the notification side effect must commit together.
    // We enqueue the event in the same transaction so a retry can safely re-run without
    // creating duplicates; the worker is the only component allowed to turn the event into a
    // notification row.
    await prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: { status, statusChangedAt: new Date() },
      });
      if (!updated.count) {
        throw new ConflictError(
          "Order status changed by another request. Refresh and try again.",
        );
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: status,
          changedByUserId,
          reason: normalizedReason ?? null,
        },
      });

      await outboxRepository.enqueue(tx, {
        eventType: "order.status.changed",
        payload: { orderId, userId: order.userId, status },
      });
    });

    // why: return the refreshed detail shape after the guarded transition commits.
    return withAdminActions(await orderPrismaRepository.findById(orderId));
  },
};
