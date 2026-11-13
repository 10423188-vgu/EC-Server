import { prisma } from "../../configs/db/index.js";
import { paymentPrismaRepository } from "./payment.prisma.repository.js";
import { cartRedisRepository } from "../cart/cart.redis.repository.js";
import { outboxRepository } from "../../shared/outbox/outbox.prisma.repository.js";
import { NotFoundError, BadRequestError } from "../../shared/errors/app.error.js";
import { logger } from "../../shared/utils/logger.js";

const BANK_ID           = process.env.BANK_ID ?? "";
const BANK_ACCOUNT_NO   = process.env.BANK_ACCOUNT_NO ?? "";
const BANK_ACCOUNT_NAME = process.env.BANK_ACCOUNT_NAME ?? "";
const BANK_NAME         = process.env.BANK_NAME ?? BANK_ID;
// why: "compact2" — VietQR template with logo + QR + account info together, easiest to read/scan
const QR_TEMPLATE = "compact2";
// why: no bank webhook wired up in this demo — a visitor's order would otherwise hang at
// "waiting for confirmation" forever unless an admin happens to be watching. Auto-confirm
// after a short random delay so the demo flow completes on its own; an admin can still
// confirm sooner from the dashboard. Set MIN to 0 to disable and require a real admin confirm.
const AUTO_CONFIRM_MIN_MS = Number(process.env.PAYMENT_AUTO_CONFIRM_MIN_MS ?? 5000);
const AUTO_CONFIRM_MAX_MS = Number(process.env.PAYMENT_AUTO_CONFIRM_MAX_MS ?? 10000);

export const paymentService = {
  // why: pure string templating, no network call — img.vietqr.io renders the QR image on
  // request, so unlike the old MoMo integration there's nothing here to sign or verify.
  // No amount param on purpose: this is a demo/portfolio project, so the QR carries no fixed
  // or real order total — anyone scanning it is freely choosing to donate whatever they want
  // to support building this site. The order/payment rows still carry the real total for
  // record-keeping; it's just never tied to what a scanner actually transfers.
  buildBankQr: ({ orderId, transferContent }) => {
    // why: short, human-typeable code the payer can enter manually if the QR scan fails —
    // an admin matches it back to this order when reading the bank statement
    const transferNote =
      transferContent ?? `DH${orderId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;

    const qrCodeUrl =
      `https://img.vietqr.io/image/${BANK_ID}-${BANK_ACCOUNT_NO}-${QR_TEMPLATE}.png` +
      `?addInfo=${encodeURIComponent(transferNote)}&accountName=${encodeURIComponent(BANK_ACCOUNT_NAME)}`;

    return {
      qrCodeUrl,
      transferContent: transferNote,
      bank: { name: BANK_NAME, accountNo: BANK_ACCOUNT_NO, accountName: BANK_ACCOUNT_NAME },
    };
  },

  // why: an admin checks their own bank app and confirms the transfer arrived, which is what
  // finalizes the order (mirrors the old MoMo IPN success path); scheduleAutoConfirm below also
  // drives this in the demo flow, so a cancelled/already-resolved payment must be rejected here
  // rather than silently resurrected
  confirmPayment: async (orderId, adminId) => {
    const payment = await paymentPrismaRepository.findByOrderId(orderId);
    if (!payment) throw new NotFoundError("Payment");
    // why: idempotent — a repeat confirm on an already-completed payment succeeds silently instead of erroring
    if (payment.status === "COMPLETED") return { orderId, status: "COMPLETED" };
    if (payment.status !== "PENDING")
      throw new BadRequestError(`Cannot confirm a payment with status ${payment.status}`);

    // why: status guard lives in the conditional UPDATE, not
    // in the read above — closes the race with cancelOrder, which guards the same way. If
    // cancelOrder wins first, paymentUpdate.count is 0 here and nothing gets overwritten.
    const order = await prisma.$transaction(async (tx) => {
      const paymentUpdate = await tx.payment.updateMany({
        where: { orderId, status: "PENDING" },
        data: { status: "COMPLETED", paidAt: new Date(), confirmedBy: adminId },
      });
      if (paymentUpdate.count === 0) return null;

      const currentOrder = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          status: true,
          userId: true,
          items: { select: { variantId: true, quantity: true } },
        },
      });
      if (!currentOrder || currentOrder.status !== "AWAITING_PAYMENT") {
        throw new BadRequestError("Payment was already resolved by a concurrent request");
      }

      const orderUpdate = await tx.order.updateMany({
        where: { id: orderId, status: currentOrder.status },
        data: { status: "PAID", statusChangedAt: new Date() },
      });
      if (orderUpdate.count === 0) throw new BadRequestError("Payment was already resolved by a concurrent request");

      await tx.orderStatusHistory.create({
        data: { orderId, fromStatus: currentOrder.status, toStatus: "PAID", changedByUserId: adminId },
      });

      await outboxRepository.enqueue(tx, {
        eventType: "order.status.changed",
        payload: { orderId, userId: currentOrder.userId, status: "PAID" },
      });
      if (currentOrder.userId) {
        await outboxRepository.enqueue(tx, {
          eventType: "order.cart.clear",
          payload: {
            orderId,
            userId: currentOrder.userId,
            items: currentOrder.items,
            expiresAt: new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          },
        });
      }
      return currentOrder;
    });
    if (!order) {
      throw new BadRequestError("Payment was already resolved by a concurrent request");
    }

    if (order.userId) {
      try {
        await cartRedisRepository.clearPurchased(
          order.userId,
          orderId,
          order.items,
        );
      } catch (error) {
        logger.warn(
          { err: error, orderId },
          "Paid order cart cleanup deferred to outbox",
        );
      }
    }

    return { orderId, status: "COMPLETED" };
  },

  // why: fire-and-forget demo mechanism, not a real job queue — acceptable because a lost
  // timer (e.g. server restart) just means the admin dashboard confirm button becomes the
  // fallback, never a hung customer with no way through
  scheduleAutoConfirm: (orderId) => {
    if (AUTO_CONFIRM_MIN_MS <= 0) return;
    const delay = AUTO_CONFIRM_MIN_MS + Math.random() * (AUTO_CONFIRM_MAX_MS - AUTO_CONFIRM_MIN_MS);
    setTimeout(() => {
      paymentService.confirmPayment(orderId, null).catch((error) => {
        logger.warn({ err: error, orderId }, "Demo payment auto-confirm failed");
      });
    }, delay);
  },
};
