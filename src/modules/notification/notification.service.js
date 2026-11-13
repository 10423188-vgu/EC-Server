import { notificationPrismaRepository } from "./notification.prisma.repository.js";

const ORDER_STATUS_MESSAGES = {
  PAID: "payment has been confirmed",
  PROCESSING: "is now being processed",
  SHIPPED: "has shipped",
  OUT_FOR_DELIVERY: "is out for delivery",
  DELIVERED: "has been delivered",
  CANCELLED: "has been cancelled",
  REFUNDED: "has been refunded",
};

export const notificationService = {
  buildOrderCreated: ({ orderId }) => ({
    type: "ORDER_CREATED",
    title: "Order received",
    message: `Your order #${orderId.slice(0, 8)} has been received and is awaiting payment.`,
    link: `/orders/${orderId}`,
  }),

  // why: pure (no DB access) — orderSchema.adminUpdateStatus already restricts status to
  // exactly the keys in ORDER_STATUS_MESSAGES, so no fallback branch is needed here
  buildOrderStatusChanged: ({ orderId, status }) => ({
    type: "ORDER_STATUS_CHANGED",
    title: "Order update",
    message: `Your order #${orderId.slice(0, 8)} ${ORDER_STATUS_MESSAGES[status]}`,
    link: `/orders/${orderId}`,
  }),

  buildOrderRefunded: ({ orderId, amount, isFullRefund }) => ({
    type: "ORDER_STATUS_CHANGED",
    title: isFullRefund ? "Order refunded" : "Partial refund completed",
    message: `${Number(amount).toLocaleString("vi-VN")} VND has been refunded for order #${orderId.slice(0, 8)}.`,
    link: `/orders/${orderId}`,
  }),

  buildReturnStatusChanged: ({ orderId, status }) => {
    const resolution = status === "APPROVED" ? "approved" : "rejected";
    return {
      type: "ORDER_STATUS_CHANGED",
      title: `Return request ${resolution}`,
      message: `Your return request for order #${orderId.slice(0, 8)} has been ${resolution}.`,
      link: `/orders/${orderId}`,
    };
  },

  list: async (userId, { page, limit }) => {
    const { notifications, total, unreadCount } = await notificationPrismaRepository.findByUser(userId, { page, limit });
    return {
      data: notifications,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      unreadCount,
    };
  },

  markRead: (userId, id) => notificationPrismaRepository.markRead(id, userId),

  markAllRead: (userId) => notificationPrismaRepository.markAllRead(userId),
};
