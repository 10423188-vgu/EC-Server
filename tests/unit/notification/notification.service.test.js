import { describe, it, expect, vi, beforeEach } from "vitest";
import { notificationService } from "../../../src/modules/notification/notification.service.js";
import { notificationPrismaRepository } from "../../../src/modules/notification/notification.prisma.repository.js";

vi.mock("../../../src/modules/notification/notification.prisma.repository.js", () => ({
  notificationPrismaRepository: {
    create: vi.fn(),
    findByUser: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notificationService.buildOrderCreated", () => {
  it("builds the confirmation notification for a newly created order", () => {
    const result = notificationService.buildOrderCreated({ orderId: "order-12345678" });

    expect(result).toEqual({
      type: "ORDER_CREATED",
      title: "Order received",
      message: "Your order #order-12 has been received and is awaiting payment.",
      link: "/orders/order-12345678",
    });
  });
});

describe("notificationService.buildOrderStatusChanged", () => {
  it.each([
    ["PROCESSING", "is now being processed"],
    ["SHIPPED", "has shipped"],
    ["OUT_FOR_DELIVERY", "is out for delivery"],
    ["DELIVERED", "has been delivered"],
    ["CANCELLED", "has been cancelled"],
    ["REFUNDED", "has been refunded"],
  ])("builds the right copy for %s", (status, expectedSuffix) => {
    const result = notificationService.buildOrderStatusChanged({ orderId: "order-12345678", status });

    expect(result).toEqual({
      type: "ORDER_STATUS_CHANGED",
      title: "Order update",
      message: `Your order #order-12 ${expectedSuffix}`,
      link: "/orders/order-12345678",
    });
  });
});

describe("notificationService.buildOrderRefunded", () => {
  it("builds partial refund copy with the refunded amount", () => {
    expect(
      notificationService.buildOrderRefunded({
        orderId: "order-12345678",
        amount: 25000,
        isFullRefund: false,
      }),
    ).toEqual({
      type: "ORDER_STATUS_CHANGED",
      title: "Partial refund completed",
      message: "25.000 VND has been refunded for order #order-12.",
      link: "/orders/order-12345678",
    });
  });
});

describe("notificationService.buildReturnStatusChanged", () => {
  it.each([
    ["APPROVED", "approved"],
    ["REJECTED", "rejected"],
  ])("builds the customer message when a return is %s", (status, result) => {
    expect(
      notificationService.buildReturnStatusChanged({
        orderId: "order-12345678",
        status,
      }),
    ).toEqual({
      type: "ORDER_STATUS_CHANGED",
      title: `Return request ${result}`,
      message: `Your return request for order #order-12 has been ${result}.`,
      link: "/orders/order-12345678",
    });
  });
});

describe("notificationService.list", () => {
  it("shapes pagination and passes unreadCount through", async () => {
    notificationPrismaRepository.findByUser.mockResolvedValue({
      notifications: [{ id: "n1" }],
      total: 25,
      unreadCount: 3,
    });

    const result = await notificationService.list("u1", { page: 2, limit: 10 });

    expect(notificationPrismaRepository.findByUser).toHaveBeenCalledWith("u1", { page: 2, limit: 10 });
    expect(result).toEqual({
      data: [{ id: "n1" }],
      pagination: { total: 25, page: 2, limit: 10, totalPages: 3 },
      unreadCount: 3,
    });
  });
});

describe("notificationService.markRead / markAllRead", () => {
  it("delegates markRead to the repository, scoped by user", async () => {
    await notificationService.markRead("u1", "n1");

    expect(notificationPrismaRepository.markRead).toHaveBeenCalledWith("n1", "u1");
  });

  it("delegates markAllRead to the repository", async () => {
    await notificationService.markAllRead("u1");

    expect(notificationPrismaRepository.markAllRead).toHaveBeenCalledWith("u1");
  });
});
