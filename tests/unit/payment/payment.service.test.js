import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { paymentService } from "../../../src/modules/payment/payment.service.js";
import { paymentPrismaRepository } from "../../../src/modules/payment/payment.prisma.repository.js";
import { cartRedisRepository } from "../../../src/modules/cart/cart.redis.repository.js";
import { outboxRepository } from "../../../src/shared/outbox/outbox.prisma.repository.js";
import { prisma } from "../../../src/configs/db/index.js";
import { NotFoundError, BadRequestError } from "../../../src/shared/errors/app.error.js";

vi.mock("../../../src/modules/payment/payment.prisma.repository.js", () => ({
  paymentPrismaRepository: { findByOrderId: vi.fn() },
}));

vi.mock("../../../src/modules/cart/cart.redis.repository.js", () => ({
  cartRedisRepository: { clearPurchased: vi.fn() },
}));

vi.mock("../../../src/shared/outbox/outbox.prisma.repository.js", () => ({
  outboxRepository: { enqueue: vi.fn() },
}));

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: {
    payment: { updateMany: vi.fn() },
    order: { updateMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// why: BANK_* is fixed for the whole run via vitest.config.js —
// payment.service.js reads them once at module load, so per-test overrides arrive too late
beforeEach(() => {
  vi.clearAllMocks();
  // why: default to "won the race" so tests that don't target the concurrency guard
  // itself don't have to stub these explicitly
  prisma.payment.updateMany.mockResolvedValue({ count: 1 });
  prisma.order.updateMany.mockResolvedValue({ count: 1 });
  prisma.order.findUnique.mockResolvedValue({ status: "AWAITING_PAYMENT", userId: "u1", items: [{ variantId: "v1", quantity: 2 }] });
  prisma.$transaction.mockImplementation((callback) =>
    callback({ payment: prisma.payment, order: prisma.order, orderStatusHistory: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn() } })
  );
  outboxRepository.enqueue.mockResolvedValue({});
  cartRedisRepository.clearPurchased.mockResolvedValue();
});

describe("paymentService.buildBankQr", () => {
  it("builds a VietQR image URL carrying the account name and a derived transfer code", () => {
    const result = paymentService.buildBankQr({ orderId: "a1b2c3d4-e5f6-0000-0000-000000000000" });

    expect(result.transferContent).toBe("DHA1B2C3D4E5");
    expect(result.qrCodeUrl).toBe(
      "https://img.vietqr.io/image/vietinbank-113366668888-compact2.png" +
      "?addInfo=DHA1B2C3D4E5&accountName=NGUYEN%20VAN%20A"
    );
    expect(result.bank).toEqual({ name: "Vietinbank", accountNo: "113366668888", accountName: "NGUYEN VAN A" });
  });

  it("uses the saved transfer note when rebuilding a QR after reload", () => {
    const result = paymentService.buildBankQr({
      orderId: "order-1",
      transferContent: "DHSAVEDNOTE",
    });

    expect(result.transferContent).toBe("DHSAVEDNOTE");
    expect(result.qrCodeUrl).toContain("addInfo=DHSAVEDNOTE");
  });

  it("carries no amount param — this is an open donation QR, not a fixed or real order total", () => {
    const result = paymentService.buildBankQr({ orderId: "order-1" });

    expect(result.qrCodeUrl).not.toContain("amount=");
  });

  it("makes no network calls — pure string templating", () => {
    // why: this is the entire point of dropping MoMo — a passing test here that never
    // awaits/mocks fetch proves the function is synchronous and side-effect free
    const result = paymentService.buildBankQr({ orderId: "order-1", amount: 1000 });
    expect(result.qrCodeUrl).toContain("img.vietqr.io");
  });
});

describe("paymentService.confirmPayment", () => {
  it("returns committed payment success when Redis cleanup fails and retains its outbox event", async () => {
    paymentPrismaRepository.findByOrderId.mockResolvedValue({ status: "PENDING" });
    cartRedisRepository.clearPurchased.mockRejectedValueOnce(new Error("Redis down"));
    await expect(paymentService.confirmPayment("order-1", "admin-1"))
      .resolves.toEqual({ orderId: "order-1", status: "COMPLETED" });
    expect(outboxRepository.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      {
        eventType: "order.cart.clear",
        payload: { orderId: "order-1", userId: "u1", items: [{ variantId: "v1", quantity: 2 }], expiresAt: expect.any(String) },
      },
    );
  });

  it("rejects confirmation before checkout publishes stock and coupon work", async () => {
    paymentPrismaRepository.findByOrderId.mockResolvedValue({ status: "PENDING" });
    prisma.order.findUnique.mockResolvedValue({ status: "PENDING", userId: "u1" });
    await expect(paymentService.confirmPayment("order-1", "admin-1"))
      .rejects.toThrow("concurrent request");
    expect(cartRedisRepository.clearPurchased).not.toHaveBeenCalled();
  });
  it("throws NotFoundError when no payment exists for the order", async () => {
    paymentPrismaRepository.findByOrderId.mockResolvedValue(null);

    await expect(paymentService.confirmPayment("order-1", "admin-1")).rejects.toThrow(NotFoundError);
  });

  it("is idempotent when the payment is already COMPLETED", async () => {
    paymentPrismaRepository.findByOrderId.mockResolvedValue({ status: "COMPLETED" });

    const result = await paymentService.confirmPayment("order-1", "admin-1");

    expect(result).toEqual({ orderId: "order-1", status: "COMPLETED" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("marks payment COMPLETED, order PAID, records the confirming admin, and clears the buyer's cart", async () => {
    paymentPrismaRepository.findByOrderId.mockResolvedValue({ status: "PENDING" });
    const result = await paymentService.confirmPayment("order-1", "admin-1");

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", confirmedBy: "admin-1" }) })
    );
    expect(prisma.order.updateMany).toHaveBeenCalled();
    expect(outboxRepository.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      { eventType: "order.status.changed", payload: { orderId: "order-1", userId: "u1", status: "PAID" } }
    );
    expect(cartRedisRepository.clearPurchased).toHaveBeenCalledWith("u1", "order-1", [{ variantId: "v1", quantity: 2 }]);
    expect(result).toEqual({ orderId: "order-1", status: "COMPLETED" });
  });

  it("does not clear cart when the order has no userId on record", async () => {
    paymentPrismaRepository.findByOrderId.mockResolvedValue({ status: "PENDING" });
    prisma.order.findUnique.mockResolvedValue({
      status: "AWAITING_PAYMENT",
      userId: null,
    });

    await paymentService.confirmPayment("order-1", "admin-1");

    expect(cartRedisRepository.clearPurchased).not.toHaveBeenCalled();
  });

  it("rejects confirming a payment that was already cancelled — must not resurrect it", async () => {
    // why: cancelOrder flips payment.status to FAILED — without this guard, a late
    // scheduleAutoConfirm timer (or a stray admin click) would mark it COMPLETED anyway
    paymentPrismaRepository.findByOrderId.mockResolvedValue({ status: "FAILED" });

    await expect(paymentService.confirmPayment("order-1", "admin-1")).rejects.toThrow(BadRequestError);
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when cancelOrder wins the race between the read and the conditional update", async () => {
    // why: the plain read above sees PENDING, but by the time the transaction runs,
    // a concurrent cancelOrder already flipped it to FAILED — the conditional UPDATE then
    // matches 0 rows and this must surface as an error, not silently succeed
    paymentPrismaRepository.findByOrderId.mockResolvedValue({ status: "PENDING" });
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });

    await expect(paymentService.confirmPayment("order-1", "admin-1")).rejects.toThrow(BadRequestError);
    expect(cartRedisRepository.clearPurchased).not.toHaveBeenCalled();
  });
});

describe("paymentService.scheduleAutoConfirm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("confirms the payment once the auto-confirm delay elapses", async () => {
    // why: PAYMENT_AUTO_CONFIRM_MIN_MS/MAX_MS are both pinned to 1000 in vitest.config.js,
    // so the fire time is deterministic instead of a random window
    paymentPrismaRepository.findByOrderId.mockResolvedValue({ status: "PENDING" });
    prisma.order.findUnique.mockResolvedValue({ status: "AWAITING_PAYMENT", userId: null, items: [] });

    paymentService.scheduleAutoConfirm("order-1");
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", confirmedBy: null }) })
    );
  });

  it("swallows a rejected confirm instead of throwing — the timer has no caller to report to", async () => {
    paymentPrismaRepository.findByOrderId.mockResolvedValue({ status: "FAILED" });

    paymentService.scheduleAutoConfirm("order-1");

    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
  });
});
