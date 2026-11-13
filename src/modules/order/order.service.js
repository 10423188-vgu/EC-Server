import { paymentService } from "../payment/payment.service.js";
import { orderPrismaRepository } from "./order.prisma.repository.js";
import { orderCheckoutService } from "./order.checkout.service.js";
import { orderAdminService } from "./order.admin.service.js";
import { cancelResolvedOrder } from "./order.cancel.service.js";
import { getReturnEligibility } from "../return/return.policy.js";
import {
  NotFoundError,
  ForbiddenError,
} from "../../shared/errors/app.error.js";
export const orderService = {
  checkout: orderCheckoutService.checkout,

  getOrders: async (userId, { page, limit, status }) => {
    const [orders, total] = await orderPrismaRepository.findByUser(userId, {
      page,
      limit,
      status,
    });
    return {
      data: orders,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },

  getOrderById: async (orderId, userId) => {
    const order = await orderPrismaRepository.findByIdAndUser(orderId, userId);
    if (!order) throw new NotFoundError("Order");
    const paymentQr =
      order.status === "AWAITING_PAYMENT" &&
      order.payment?.method === "BANK_TRANSFER" &&
      order.payment.status === "PENDING"
        ? paymentService.buildBankQr({
            orderId: order.id,
            transferContent: order.payment.transferContent,
          })
        : null;
    return { ...order, ...getReturnEligibility(order), paymentQr };
  },

  cancelOrder: async (orderId, userId) => {
    const order = await orderPrismaRepository.findByIdAndUser(orderId, userId);
    if (!order) throw new NotFoundError("Order");

    if (order.status !== "AWAITING_PAYMENT")
      throw new ForbiddenError("Only pending orders can be cancelled");

    // why: status guard lives in the conditional UPDATE, racing
    // safely against confirmPayment's own conditional update. Stock is only restored after
    // confirming this request actually won the transition — if confirmPayment got there first,
    // count is 0 and we must not credit stock back on an order that's actually PAID now.
    return cancelResolvedOrder({ order, changedByUserId: userId });
  },

  ...orderAdminService,
};
