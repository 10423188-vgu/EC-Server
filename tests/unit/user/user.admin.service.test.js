import { beforeEach, describe, expect, it, vi } from "vitest";
import { userService } from "../../../src/modules/user/user.service.js";
import { userPrismaRepository } from "../../../src/modules/user/user.prisma.repository.js";
import { sessionRedisRepository } from "../../../src/modules/auth/session.redis.repository.js";
import { userSchema } from "../../../src/modules/user/user.schema.js";
import { orderPrismaRepository } from "../../../src/modules/order/order.prisma.repository.js";

vi.mock("../../../src/modules/order/order.prisma.repository.js", () => ({
  orderPrismaRepository: { getSpendStats: vi.fn() },
}));

vi.mock("../../../src/modules/auth/session.redis.repository.js", () => ({
  sessionRedisRepository: { deleteAllSessions: vi.fn() },
}));

vi.mock("../../../src/modules/user/user.prisma.repository.js", () => ({
  userPrismaRepository: {
    findCustomers: vi.fn(),
    findCustomerDetails: vi.fn(),
    findCustomerOrders: vi.fn(),
    findById: vi.fn(),
    findByIdWithAddresses: vi.fn(),
    update: vi.fn(),
    setCustomerSuspension: vi.fn(),
    getCustomerOverview: vi.fn(),
    findCustomerExportBatch: vi.fn(),
    countSelectedCustomers: vi.fn(),
  },
}));

describe("userService.adminListCustomers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps order counts and returns pagination metadata", async () => {
    userPrismaRepository.findCustomers.mockResolvedValue([
      [
        {
          id: "customer-1",
          name: "Alex",
          email: "alex@example.com",
          _count: { orders: 3 },
        },
      ],
      26,
    ]);

    const result = await userService.adminListCustomers({
      page: 2,
      limit: 25,
      search: "alex",
      status: "active",
      sortBy: "orders",
      sortOrder: "asc",
    });

    expect(userPrismaRepository.findCustomers).toHaveBeenCalledWith(
      25,
      25,
      "alex",
      "active",
      "orders",
      "asc",
    );
    expect(result).toEqual({
      data: [
        {
          id: "customer-1",
          name: "Alex",
          email: "alex@example.com",
          ordersCount: 3,
        },
      ],
      pagination: { total: 26, page: 2, limit: 25, totalPages: 2 },
    });
  });
});

describe("userService.adminGetCustomer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a missing or non-customer account before reading orders", async () => {
    userPrismaRepository.findCustomerDetails.mockResolvedValue(null);
    await expect(
      userService.adminGetCustomer("missing", 1),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(userPrismaRepository.findCustomerOrders).not.toHaveBeenCalled();
  });

  it("returns paginated orders, saved addresses and net spend", async () => {
    userPrismaRepository.findCustomerDetails.mockResolvedValue({
      id: "customer-1",
      name: "Alex",
      addresses: [{ id: "address-1" }],
      _count: { orders: 23 },
    });
    userPrismaRepository.findCustomerOrders.mockResolvedValue([
      { id: "order-11" },
    ]);
    orderPrismaRepository.getSpendStats.mockResolvedValue({
      count: 20,
      totalSpent: 125000,
    });

    const result = await userService.adminGetCustomer("customer-1", 2);
    expect(userPrismaRepository.findCustomerOrders).toHaveBeenCalledWith(
      "customer-1",
      10,
      10,
    );
    expect(result).toEqual({
      id: "customer-1",
      name: "Alex",
      addresses: [{ id: "address-1" }],
      ordersCount: 23,
      totalSpent: 125000,
      orders: [{ id: "order-11" }],
      pagination: { page: 2, totalPages: 3 },
    });
  });
});

describe("customer overview and CSV", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts the dashboard overview periods", () => {
    for (const days of [7, 14, 30, 90]) {
      expect(
        userSchema.adminCustomerOverview.safeParse({ query: { days } }).success,
      ).toBe(true);
    }
    expect(
      userSchema.adminCustomerOverview.safeParse({ query: { days: 60 } })
        .success,
    ).toBe(false);
  });

  it("fills missing days and builds a running customer total", async () => {
    userPrismaRepository.getCustomerOverview.mockImplementation(
      async (since) => ({
        total: 10,
        newCustomers: 2,
        activeCustomers: 3,
        previousNewCustomers: 1,
        previousActiveCustomers: 2,
        segments: { heavy: 1, regular: 2, occasional: 3, none: 4 },
        daily: [
          { day: new Date(since), count: 1 },
          { day: new Date(since.getTime() + 2 * 86400000), count: 1 },
        ],
        activeDaily: [{ day: new Date(since), count: 2 }],
      }),
    );

    const result = await userService.adminCustomerOverview(7);

    const [since, previousSince] =
      userPrismaRepository.getCustomerOverview.mock.calls[0];
    expect(since.getTime() - previousSince.getTime()).toBe(7 * 86400000);
    expect(result).toMatchObject({
      previousNewCustomers: 1,
      previousActiveCustomers: 2,
    });

    expect(result.growth.map((point) => point.total)).toEqual([
      9, 9, 10, 10, 10, 10, 10,
    ]);
    expect(result.growth.map((point) => point.newCustomers)).toEqual([
      1, 0, 1, 0, 0, 0, 0,
    ]);
    expect(result.growth.map((point) => point.activeCustomers)).toEqual([
      2, 0, 0, 0, 0, 0, 0,
    ]);
    expect(result.segments.none).toBe(4);
  });

  it("escapes spreadsheet formulas in exported customer fields", async () => {
    userPrismaRepository.findCustomerExportBatch.mockResolvedValueOnce([
      {
        id: "id-1",
        name: "=SUM(1,1)",
        email: "customer@example.com",
        phone: null,
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        suspendedAt: null,
        _count: { orders: 2 },
      },
    ]);

    let csv = "";
    for await (const chunk of userService.adminExportCustomersCsv({}))
      csv += chunk;

    expect(csv).toContain('"\'=SUM(1,1)"');
    expect(csv).toContain('"Active","2"');
  });

  it("rejects selected exports containing unavailable customers", async () => {
    userPrismaRepository.countSelectedCustomers.mockResolvedValue(1);
    await expect(
      userService.adminValidateSelectedCustomers(["first", "second"]),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("admin customer creation", () => {
  it("accepts registration fields but rejects a supplied role", () => {
    const body = {
      name: "Alex",
      email: "alex@example.com",
      password: "secret123",
    };
    expect(userSchema.adminCreateCustomer.safeParse({ body }).success).toBe(
      true,
    );
    expect(
      userSchema.adminCreateCustomer.safeParse({
        body: { ...body, role: "ADMIN" },
      }).success,
    ).toBe(false);
  });
});

describe("customer account access", () => {
  beforeEach(() => vi.resetAllMocks());

  it("prevents self-suspension before writing", async () => {
    await expect(
      userService.adminSetCustomerSuspension("admin", "admin", true),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(userPrismaRepository.setCustomerSuspension).not.toHaveBeenCalled();
  });

  it("does not change protected admin accounts or missing customers", async () => {
    userPrismaRepository.setCustomerSuspension.mockResolvedValue({ count: 0 });
    await expect(
      userService.adminSetCustomerSuspension("admin", "other-admin", true),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(sessionRedisRepository.deleteAllSessions).not.toHaveBeenCalled();
  });

  it("persists suspension even if Redis cleanup fails", async () => {
    userPrismaRepository.setCustomerSuspension.mockResolvedValue({ count: 1 });
    sessionRedisRepository.deleteAllSessions.mockRejectedValue(
      new Error("Redis down"),
    );
    await expect(
      userService.adminSetCustomerSuspension("admin", "customer", true),
    ).resolves.toEqual({ id: "customer", suspended: true });
    expect(sessionRedisRepository.deleteAllSessions).toHaveBeenCalledWith(
      "customer",
    );
  });
});
