import { beforeEach, describe, expect, it, vi } from "vitest";
import { recoverCheckout } from "../../../src/modules/order/checkout.recovery.js";
import { prisma } from "../../../src/configs/db/index.js";
import { Product } from "../../../src/models/product.model.js";

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: { $transaction: vi.fn() },
}));
vi.mock("../../../src/models/product.model.js", () => ({
  Product: { bulkWrite: vi.fn() },
}));

let tx;
const order = {
  id: "order-1",
  status: "PENDING",
  couponId: "coupon-1",
  statusHistory: [{ id: "recovery-history" }],
  items: [{ variantId: "variant-1", quantity: 2 }],
};

beforeEach(() => {
  vi.resetAllMocks();
  tx = {
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    payment: { updateMany: vi.fn() },
    couponUsage: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    coupon: { updateMany: vi.fn() },
    orderStatusHistory: { create: vi.fn() },
  };
  prisma.$transaction.mockImplementation((callback) => callback(tx));
  Product.bulkWrite.mockResolvedValue({});
});

describe("checkout recovery", () => {
  it("does not restore a published order cancelled through the normal customer flow", async () => {
    tx.order.findUnique.mockResolvedValue({
      ...order,
      status: "CANCELLED",
      statusHistory: [],
    });
    await recoverCheckout(order.id);
    expect(Product.bulkWrite).not.toHaveBeenCalled();
  });
  it("cancels an unfinished checkout and releases coupon usage before restoring Mongo", async () => {
    await recoverCheckout(order.id);
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { orderId: order.id, status: "PENDING" },
      data: { status: "FAILED" },
    });
    expect(tx.coupon.updateMany).toHaveBeenCalledWith({
      where: { id: order.couponId, usageCount: { gte: 1 } },
      data: { usageCount: { decrement: 1 } },
    });
    expect(Product.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it("does not restore stock if checkout publication won the conditional update", async () => {
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    await recoverCheckout(order.id);
    expect(Product.bulkWrite).not.toHaveBeenCalled();
    expect(tx.couponUsage.deleteMany).not.toHaveBeenCalled();
  });

  it.each(["AWAITING_PAYMENT", "PAID", "DELIVERED"])(
    "leaves a published %s order alone",
    async (status) => {
      tx.order.findUnique.mockResolvedValue({ ...order, status });
      await recoverCheckout(order.id);
      expect(tx.order.updateMany).not.toHaveBeenCalled();
      expect(Product.bulkWrite).not.toHaveBeenCalled();
    },
  );

  it("retries Mongo after cancellation without repeating the coupon release", async () => {
    tx.order.findUnique.mockResolvedValue({ ...order, status: "CANCELLED" });
    Product.bulkWrite.mockRejectedValueOnce(new Error("Mongo unavailable"));
    await expect(recoverCheckout(order.id)).rejects.toThrow(
      "Mongo unavailable",
    );
    await recoverCheckout(order.id);
    expect(Product.bulkWrite).toHaveBeenCalledTimes(2);
    expect(tx.couponUsage.deleteMany).not.toHaveBeenCalled();
  });
});
