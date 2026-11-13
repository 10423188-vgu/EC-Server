import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationPrismaRepository } from "../../../src/modules/notification/notification.prisma.repository.js";
import { outboxHandlers } from "../../../src/shared/outbox/outbox.handlers.js";

vi.mock("../../../src/models/product.model.js", () => ({
  Product: { bulkWrite: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("../../../src/configs/db/index.js", () => ({
  prisma: { returnRequest: { update: vi.fn() } },
}));

vi.mock("../../../src/modules/notification/notification.prisma.repository.js", () => ({
  notificationPrismaRepository: { create: vi.fn() },
}));

vi.mock("../../../src/modules/notification/notification.service.js", () => ({
  notificationService: {
    buildOrderCreated: vi.fn(),
    buildOrderStatusChanged: vi.fn(),
    buildOrderRefunded: vi.fn(),
    buildReturnStatusChanged: vi.fn(() => ({
      type: "ORDER_STATUS_CHANGED",
      title: "Return request approved",
      message: "Your return request was approved.",
      link: "/orders/order-1",
    })),
  },
}));

beforeEach(() => vi.clearAllMocks());

describe("outboxHandlers return status notifications", () => {
  const payload = {
    orderId: "order-1",
    userId: "user-1",
    status: "APPROVED",
  };

  it("creates an idempotent notification using the outbox event ID", async () => {
    notificationPrismaRepository.create.mockResolvedValue({ id: "notification-1" });

    await outboxHandlers["return.status.changed"](payload, {
      eventId: "event-1",
    });

    expect(notificationPrismaRepository.create).toHaveBeenCalledWith({
      userId: "user-1",
      orderId: "order-1",
      eventKey: "event-1",
      type: "ORDER_STATUS_CHANGED",
      title: "Return request approved",
      message: "Your return request was approved.",
      link: "/orders/order-1",
    });
  });

  it("treats a duplicate event key as an already-created notification", async () => {
    notificationPrismaRepository.create.mockRejectedValue({ code: "P2002" });

    await expect(
      outboxHandlers["return.status.changed"](payload, {
        eventId: "event-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("rethrows other failures so the worker can retry", async () => {
    const error = new Error("Database unavailable");
    notificationPrismaRepository.create.mockRejectedValue(error);

    await expect(
      outboxHandlers["return.status.changed"](payload, {
        eventId: "event-1",
      }),
    ).rejects.toBe(error);
  });
});
