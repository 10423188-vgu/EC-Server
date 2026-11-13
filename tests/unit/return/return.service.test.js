import { beforeEach, describe, expect, it, vi } from "vitest";
import { returnService } from "../../../src/modules/return/return.service.js";
import { prisma } from "../../../src/configs/db/index.js";
import { outboxRepository } from "../../../src/shared/outbox/outbox.prisma.repository.js";
import { BadRequestError } from "../../../src/shared/errors/app.error.js";

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    returnRequest: { findUnique: vi.fn() },
  },
}));

vi.mock("../../../src/shared/outbox/outbox.prisma.repository.js", () => ({
  outboxRepository: { enqueue: vi.fn() },
}));

describe("returnService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a return only with items from a delivered order", async () => {
    const create = vi.fn().mockResolvedValue({ id: "return-1" });
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: "order-1",
            status: "DELIVERED",
            statusChangedAt: new Date(),
            items: [{ id: "item-1", quantity: 2 }],
            returnRequests: [],
          }),
        },
        returnRequest: { create },
      }),
    );

    await returnService.create("order-1", "user-1", {
      reason: "Wrong size",
      evidenceImages: [],
      items: [{ orderItemId: "item-1", quantity: 2 }],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: "order-1", userId: "user-1" }),
      }),
    );
  });

  it("accepts a partial return request", async () => {
    const create = vi.fn().mockResolvedValue({ id: "return-1" });
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: "order-1",
            status: "DELIVERED",
            statusChangedAt: new Date(),
            items: [{ id: "item-1", quantity: 2 }],
            returnRequests: [],
          }),
        },
        returnRequest: { create },
      }),
    );

    await returnService.create("order-1", "user-1", {
      reason: "Wrong size",
      evidenceImages: [],
      items: [{ orderItemId: "item-1", quantity: 1 }],
    });
    expect(create).toHaveBeenCalled();
  });

  it("rejects quantities already accepted in a previous return", async () => {
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: "order-1",
            status: "DELIVERED",
            statusChangedAt: new Date(),
            items: [{ id: "item-1", quantity: 2 }],
            returnRequests: [
              {
                status: "REFUNDED",
                items: [{ orderItemId: "item-1", quantity: 1 }],
              },
            ],
          }),
        },
        returnRequest: { create: vi.fn() },
      }),
    );

    await expect(
      returnService.create("order-1", "user-1", {
        reason: "Wrong size",
        evidenceImages: [],
        items: [{ orderItemId: "item-1", quantity: 2 }],
      }),
    ).rejects.toThrow("Return quantity exceeds the remaining quantity");
  });

  it("blocks a second request while one is awaiting inspection", async () => {
    const create = vi.fn();
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: "order-1",
            status: "DELIVERED",
            statusChangedAt: new Date(),
            items: [{ id: "item-1", quantity: 2 }],
            returnRequests: [{ status: "INSPECTING", items: [] }],
          }),
        },
        returnRequest: { create },
      }),
    );

    await expect(
      returnService.create("order-1", "user-1", {
        reason: "Wrong size",
        evidenceImages: [],
        items: [{ orderItemId: "item-1", quantity: 1 }],
      }),
    ).rejects.toThrow("Resolve the current return");
    expect(create).not.toHaveBeenCalled();
  });

  it("calculates a partial return refund from the item total", async () => {
    const update = vi.fn();
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        returnRequest: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue({
            id: "return-1",
            orderId: "order-1",
            userId: "user-1",
            status: "INSPECTING",
            order: {
              items: [{ id: "item-1", quantity: 2, subtotal: 100 }],
              discountAmount: 0,
              shippingFee: 10,
              payment: { amount: 100, refundedAmount: 0, status: "COMPLETED" },
            },
            items: [{ orderItemId: "item-1", quantity: 1 }],
          }),
          update,
        },
      }),
    );
    prisma.returnRequest.findUnique.mockResolvedValue({ id: "return-1" });

    await returnService.adminUpdateStatus("return-1", "admin-1", {
      status: "APPROVED",
      inspectionResult: "Item inspected",
      restockItemIds: [],
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refundAmount: 50 }),
      }),
    );
  });

  it("closes a zero-value return without requesting a bank transfer", async () => {
    const update = vi.fn();
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        returnRequest: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue({
            id: "return-1",
            orderId: "order-1",
            userId: "user-1",
            status: "INSPECTING",
            order: {
              items: [
                { id: "item-1", quantity: 1, subtotal: 100 },
                { id: "item-2", quantity: 1, subtotal: 50 },
              ],
              discountAmount: 150,
              shippingFee: 10,
              payment: { amount: 10, refundedAmount: 0, status: "COMPLETED" },
            },
            items: [{ orderItemId: "item-1", quantity: 1 }],
          }),
          update,
        },
      }),
    );
    prisma.returnRequest.findUnique.mockResolvedValue({ id: "return-1" });

    await returnService.adminUpdateStatus("return-1", "admin-1", {
      status: "APPROVED",
      inspectionResult: "Returned but fully discounted",
      restockItemIds: [],
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "NO_REFUND",
          refundAmount: 0,
        }),
      }),
    );
  });

  it("rejects return requests after the 30-day window", async () => {
    const create = vi.fn();
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: "order-1",
            status: "DELIVERED",
            statusChangedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
            items: [{ id: "item-1", quantity: 1 }],
            returnRequests: [],
          }),
        },
        returnRequest: { create },
      }),
    );

    await expect(
      returnService.create("order-1", "user-1", {
        reason: "Wrong size",
        evidenceImages: [],
        items: [{ orderItemId: "item-1", quantity: 1 }],
      }),
    ).rejects.toThrow("Returns must be requested within 30 days of delivery");
    expect(create).not.toHaveBeenCalled();
  });

  it("restocks only approved, restockable items through the outbox", async () => {
    const update = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        returnRequest: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue({
            id: "return-1",
            orderId: "order-1",
            userId: "user-1",
            status: "INSPECTING",
            order: {
              items: [{ id: "item-1", quantity: 1, subtotal: 100 }],
              discountAmount: 0,
              shippingFee: 0,
              payment: { amount: 100, refundedAmount: 0, status: "COMPLETED" },
            },
            items: [
              {
                orderItemId: "item-1",
                quantity: 1,
                orderItem: { variantId: "variant-1" },
              },
            ],
          }),
          update,
        },
        returnRequestItem: { updateMany },
      }),
    );
    prisma.returnRequest.findUnique.mockResolvedValue({
      id: "return-1",
      status: "APPROVED",
    });

    await returnService.adminUpdateStatus("return-1", "admin-1", {
      status: "APPROVED",
      inspectionResult: "Sealed and resellable",
      restockItemIds: ["item-1"],
    });

    expect(outboxRepository.enqueue).toHaveBeenCalledWith(expect.anything(), {
      eventType: "order.stock.restore",
      payload: {
        orderId: "order-1",
        returnRequestId: "return-1",
        items: [{ variantId: "variant-1", quantity: 1 }],
      },
    });
    expect(outboxRepository.enqueue).toHaveBeenCalledWith(expect.anything(), {
      eventType: "return.status.changed",
      payload: {
        orderId: "order-1",
        userId: "user-1",
        status: "APPROVED",
      },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "APPROVED",
          refundAmount: 100,
        }),
      }),
    );
  });

  it("rejects invalid status transitions", async () => {
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        returnRequest: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue({
            id: "return-1",
            status: "REQUESTED",
          }),
        },
      }),
    );

    await expect(
      returnService.adminUpdateStatus("return-1", "admin-1", {
        status: "APPROVED",
        inspectionResult: "Looks fine",
        restockItemIds: [],
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it("enqueues a customer notification when a return is rejected", async () => {
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        returnRequest: {
          findUnique: vi.fn().mockResolvedValue({
            id: "return-1",
            orderId: "order-1",
            userId: "user-1",
            status: "INSPECTING",
          }),
          update: vi.fn(),
        },
      }),
    );

    await returnService.adminUpdateStatus("return-1", "admin-1", {
      status: "REJECTED",
      inspectionResult: "Item does not match return policy",
      restockItemIds: [],
    });

    expect(outboxRepository.enqueue).toHaveBeenCalledWith(expect.anything(), {
      eventType: "return.status.changed",
      payload: {
        orderId: "order-1",
        userId: "user-1",
        status: "REJECTED",
      },
    });
  });

  it("does not restore stock when no returned items are selected", async () => {
    const updateMany = vi.fn();
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        $queryRaw: vi.fn(),
        returnRequest: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue({
            id: "return-1",
            orderId: "order-1",
            userId: "user-1",
            status: "INSPECTING",
            order: {
              items: [{ id: "item-1", quantity: 1, subtotal: 100 }],
              discountAmount: 0,
              shippingFee: 0,
              payment: { amount: 100, refundedAmount: 0, status: "COMPLETED" },
            },
            items: [
              {
                orderItemId: "item-1",
                quantity: 1,
                orderItem: { variantId: "variant-1" },
              },
            ],
          }),
          update: vi.fn(),
        },
        returnRequestItem: { updateMany },
      }),
    );

    await returnService.adminUpdateStatus("return-1", "admin-1", {
      status: "APPROVED",
      inspectionResult: "Item is damaged",
      restockItemIds: [],
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(outboxRepository.enqueue).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "order.stock.restore" }),
    );
  });
});
